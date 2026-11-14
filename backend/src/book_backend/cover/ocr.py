import asyncio
import csv
import io
import subprocess
from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass

import cv2
import numpy as np
from PIL import Image, ImageFilter, ImageOps, UnidentifiedImageError

from .models import OcrLine


@dataclass(slots=True)
class CoverImage:
    image: Image.Image

    @classmethod
    def decode(cls, image_bytes: bytes, max_pixels: int = 20_000_000) -> "CoverImage":
        try:
            with Image.open(io.BytesIO(image_bytes)) as source:
                width, height = source.size
                if width <= 0 or height <= 0 or width * height > max_pixels:
                    raise ValueError("Cover image has too many pixels")
                source.load()
                image = ImageOps.exif_transpose(source).convert("RGB")
        except (UnidentifiedImageError, OSError) as error:
            raise ValueError("Cover image could not be decoded") from error
        return cls(image=image)

    @property
    def width(self) -> int:
        return self.image.width

    @property
    def height(self) -> int:
        return self.image.height

    def to_tesseract_png(self) -> bytes:
        prepared = correct_cover_perspective(self.image)
        if prepared.width > 1800 or prepared.height > 2400:
            prepared.thumbnail((1800, 2400), Image.Resampling.LANCZOS)
        elif prepared.width < 900:
            scale = min(2.0, 900 / max(prepared.width, 1))
            prepared = prepared.resize(
                (round(prepared.width * scale), round(prepared.height * scale)),
                Image.Resampling.LANCZOS,
            )
        grayscale = ImageOps.grayscale(prepared)
        grayscale = ImageOps.autocontrast(grayscale, cutoff=1)
        grayscale = grayscale.filter(ImageFilter.SHARPEN)
        output = io.BytesIO()
        grayscale.save(output, format="PNG", optimize=True)
        return output.getvalue()


def correct_cover_perspective(image: Image.Image) -> Image.Image:
    pixels = np.asarray(image.convert("RGB"))
    gray = cv2.cvtColor(pixels, cv2.COLOR_RGB2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blurred, 45, 140)
    edges = cv2.dilate(edges, np.ones((3, 3), dtype=np.uint8), iterations=1)
    contours, _hierarchy = cv2.findContours(
        edges,
        cv2.RETR_EXTERNAL,
        cv2.CHAIN_APPROX_SIMPLE,
    )
    image_area = image.width * image.height
    for contour in sorted(contours, key=cv2.contourArea, reverse=True)[:8]:
        area = cv2.contourArea(contour)
        if area < image_area * 0.22:
            break
        perimeter = cv2.arcLength(contour, True)
        polygon = cv2.approxPolyDP(contour, 0.025 * perimeter, True)
        if len(polygon) != 4 or not cv2.isContourConvex(polygon):
            continue
        source = _order_corners(polygon.reshape(4, 2).astype(np.float32))
        top_width = np.linalg.norm(source[1] - source[0])
        bottom_width = np.linalg.norm(source[2] - source[3])
        left_height = np.linalg.norm(source[3] - source[0])
        right_height = np.linalg.norm(source[2] - source[1])
        width = round(max(top_width, bottom_width))
        height = round(max(left_height, right_height))
        if width < image.width * 0.3 or height < image.height * 0.3:
            continue
        ratio = width / max(height, 1)
        if not 0.4 <= ratio <= 1.1:
            continue
        destination = np.array(
            [[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]],
            dtype=np.float32,
        )
        transform = cv2.getPerspectiveTransform(source, destination)
        corrected = cv2.warpPerspective(
            pixels,
            transform,
            (width, height),
            flags=cv2.INTER_CUBIC,
        )
        return Image.fromarray(corrected, mode="RGB")
    return image.copy()


def _order_corners(points: np.ndarray) -> np.ndarray:
    ordered = np.zeros((4, 2), dtype=np.float32)
    sums = points.sum(axis=1)
    differences = np.diff(points, axis=1).reshape(-1)
    ordered[0] = points[np.argmin(sums)]
    ordered[2] = points[np.argmax(sums)]
    ordered[1] = points[np.argmin(differences)]
    ordered[3] = points[np.argmax(differences)]
    return ordered


class TesseractCoverOcr:
    def __init__(
        self,
        runner: Callable[..., subprocess.CompletedProcess[bytes]] = subprocess.run,
        timeout_seconds: float = 8,
    ):
        self.runner = runner
        self.timeout_seconds = timeout_seconds

    async def read(self, image_bytes: bytes) -> list[OcrLine]:
        input_bytes = await asyncio.to_thread(
            lambda: CoverImage.decode(image_bytes).to_tesseract_png()
        )
        try:
            result = await asyncio.to_thread(
                self.runner,
                ["tesseract", "stdin", "stdout", "-l", "eng", "--psm", "11", "tsv"],
                input=input_bytes,
                capture_output=True,
                timeout=self.timeout_seconds,
                check=False,
            )
        except FileNotFoundError as error:
            raise RuntimeError("Tesseract OCR is not installed") from error
        except subprocess.TimeoutExpired as error:
            raise TimeoutError("Cover OCR timed out") from error
        if result.returncode != 0:
            raise RuntimeError("Tesseract OCR failed")
        return parse_tesseract_tsv(result.stdout.decode("utf-8", errors="replace"))


def parse_tesseract_tsv(value: str) -> list[OcrLine]:
    groups: dict[tuple[str, str, str, str], list[dict[str, str]]] = defaultdict(list)
    reader = csv.DictReader(io.StringIO(value), delimiter="\t")
    for row in reader:
        text = (row.get("text") or "").strip()
        try:
            confidence = float(row.get("conf") or -1)
        except ValueError:
            continue
        if not text or confidence < 35:
            continue
        key = (
            row.get("page_num") or "",
            row.get("block_num") or "",
            row.get("par_num") or "",
            row.get("line_num") or "",
        )
        groups[key].append(row)

    lines: list[OcrLine] = []
    for words in groups.values():
        try:
            confidences = [float(word["conf"]) for word in words]
            tops = [int(word["top"]) for word in words]
            bottoms = [int(word["top"]) + int(word["height"]) for word in words]
        except (KeyError, ValueError):
            continue
        lines.append(
            OcrLine(
                text=" ".join(word["text"].strip() for word in words),
                confidence=sum(confidences) / len(confidences),
                top=min(tops),
                height=max(bottoms) - min(tops),
            )
        )
    return sorted(lines, key=lambda line: line.top)


def difference_hash(image: Image.Image, hash_size: int = 8) -> int:
    resized = ImageOps.grayscale(image).resize(
        (hash_size + 1, hash_size),
        Image.Resampling.LANCZOS,
    )
    pixels = list(resized.get_flattened_data())
    value = 0
    for row in range(hash_size):
        offset = row * (hash_size + 1)
        for column in range(hash_size):
            value = (value << 1) | int(pixels[offset + column] > pixels[offset + column + 1])
    return value
