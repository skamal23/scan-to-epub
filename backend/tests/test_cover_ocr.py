import io
import shutil

import pytest
from PIL import Image, ImageDraw, ImageFont

from book_backend.cover.ocr import (
    CoverImage,
    TesseractCoverOcr,
    correct_cover_perspective,
    difference_hash,
    parse_tesseract_tsv,
)
from book_backend.cover.service import CoverRecognitionService, NoCoverComparator
from book_backend.metadata.providers import FixtureMetadataProvider
from book_backend.metadata.service import MetadataSearchService


def jpeg_bytes(width: int = 600, height: int = 900) -> bytes:
    output = io.BytesIO()
    Image.new("RGB", (width, height), "white").save(output, format="JPEG")
    return output.getvalue()


def generated_cover_bytes() -> bytes:
    image = Image.new("RGB", (1000, 1500), "#F4F1EA")
    draw = ImageDraw.Draw(image)
    title_font = ImageFont.load_default(size=88)
    author_font = ImageFont.load_default(size=56)
    draw.text((90, 300), "PRIDE AND PREJUDICE", fill="#111111", font=title_font)
    draw.text((300, 900), "Jane Austen", fill="#111111", font=author_font)
    output = io.BytesIO()
    image.save(output, format="JPEG", quality=92)
    return output.getvalue()


def test_cover_image_decodes_and_bounds_pixels_without_writing_a_file():
    image = CoverImage.decode(jpeg_bytes(1200, 1800), max_pixels=3_000_000)

    assert image.width == 1200
    assert image.height == 1800
    assert image.to_tesseract_png().startswith(b"\x89PNG")


def test_cover_image_rejects_corrupt_and_decompression_bomb_dimensions():
    with pytest.raises(ValueError, match="could not be decoded"):
        CoverImage.decode(b"not-an-image")
    with pytest.raises(ValueError, match="too many pixels"):
        CoverImage.decode(jpeg_bytes(1200, 1800), max_pixels=1_000_000)


def test_perspective_correction_rectifies_a_clear_cover_quadrilateral():
    image = Image.new("RGB", (700, 900), "#111111")
    draw = ImageDraw.Draw(image)
    draw.polygon([(150, 90), (560, 130), (620, 790), (80, 820)], fill="white")

    corrected = correct_cover_perspective(image)

    assert corrected.size != image.size
    assert corrected.height > corrected.width
    assert 0.55 < corrected.width / corrected.height < 0.9
    assert corrected.convert("L").getpixel((20, 20)) > 180


def test_perspective_correction_leaves_an_uncertain_image_unchanged():
    image = Image.new("RGB", (700, 900), "white")

    corrected = correct_cover_perspective(image)

    assert corrected.size == image.size


def test_tesseract_tsv_parser_groups_words_into_lines_and_filters_noise():
    tsv = "\n".join(
        [
            "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
            "5\t1\t1\t1\t1\t1\t10\t80\t120\t38\t96.0\tPRIDE",
            "5\t1\t1\t1\t1\t2\t140\t80\t80\t38\t94.0\tAND",
            "5\t1\t1\t1\t1\t3\t230\t80\t240\t38\t95.0\tPREJUDICE",
            "5\t1\t1\t1\t2\t1\t20\t300\t90\t22\t91.0\tJane",
            "5\t1\t1\t1\t2\t2\t120\t300\t110\t22\t90.0\tAusten",
            "5\t1\t2\t1\t1\t1\t4\t700\t10\t6\t18.0\tx",
        ]
    )

    lines = parse_tesseract_tsv(tsv)

    assert [(line.text, line.top, line.height) for line in lines] == [
        ("PRIDE AND PREJUDICE", 80, 38),
        ("Jane Austen", 300, 22),
    ]
    assert lines[0].confidence == pytest.approx(95.0)


def test_difference_hash_is_equal_for_identical_images_and_low_for_opposites():
    light = Image.new("L", (20, 20), "white")
    dark = Image.new("L", (20, 20), "black")
    striped = Image.new("L", (20, 20), "white")
    for x in range(10):
        for y in range(20):
            striped.putpixel((x, y), 0)

    assert difference_hash(light) == difference_hash(light.copy())
    assert difference_hash(light) != difference_hash(striped)
    assert difference_hash(dark) == difference_hash(light)


@pytest.mark.anyio
async def test_tesseract_engine_uses_in_memory_stdin_and_parses_stdout():
    calls = []

    def runner(command, **kwargs):
        calls.append((command, kwargs))

        class Completed:
            returncode = 0
            stderr = b""
            stdout = (
                b"level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n"
                b"5\t1\t1\t1\t1\t1\t10\t80\t300\t38\t96.0\tFRANKENSTEIN\n"
            )

        return Completed()

    engine = TesseractCoverOcr(runner=runner)

    lines = await engine.read(jpeg_bytes())

    assert lines[0].text == "FRANKENSTEIN"
    command, options = calls[0]
    assert command[:3] == ["tesseract", "stdin", "stdout"]
    assert options["input"].startswith(b"\x89PNG")
    assert options["timeout"] == 8
    assert options["check"] is False


@pytest.mark.anyio
async def test_real_tesseract_reads_a_generated_cover_fixture():
    if not shutil.which("tesseract"):
        pytest.skip("Tesseract is not installed")

    lines = await TesseractCoverOcr().read(generated_cover_bytes())

    text = " ".join(line.text for line in lines).casefold()
    assert "pride and prejudice" in text
    assert "jane austen" in text


@pytest.mark.anyio
async def test_generated_cover_reaches_the_correct_work_end_to_end():
    if not shutil.which("tesseract"):
        pytest.skip("Tesseract is not installed")
    service = CoverRecognitionService(
        ocr=TesseractCoverOcr(),
        metadata=MetadataSearchService([FixtureMetadataProvider()]),
        comparator=NoCoverComparator(),
    )

    result = await service.recognize(generated_cover_bytes())

    assert result.status == "matched"
    assert result.confidence == "high"
    assert result.candidates[0].work.title == "Pride and Prejudice"
