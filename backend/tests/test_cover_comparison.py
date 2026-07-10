import io

import pytest
from PIL import Image, ImageDraw

from book_backend.cover.comparison import HttpCoverComparator
from book_backend.metadata.models import (
    EditionSummary,
    MetadataCandidate,
    SourceEvidence,
    WorkSummary,
)


def image_bytes(invert: bool = False) -> bytes:
    image = Image.new("RGB", (300, 450), "black" if invert else "white")
    draw = ImageDraw.Draw(image)
    draw.rectangle((30, 40, 270, 210), fill="white" if invert else "black")
    draw.ellipse((90, 280, 210, 400), fill="white" if invert else "black")
    output = io.BytesIO()
    image.save(output, format="JPEG", quality=95)
    return output.getvalue()


def candidate(url: str | None) -> MetadataCandidate:
    return MetadataCandidate(
        candidate_id="book",
        confidence="medium",
        match_reasons=[],
        work=WorkSummary(
            title="Book",
            authors=["Author"],
            first_published_year=None,
            language="en",
            source_ids={},
        ),
        edition=EditionSummary(
            title="Book",
            publisher=None,
            published_date=None,
            isbn10=None,
            isbn13=None,
            cover_url=url,
            source_ids={},
        ),
        sources=[SourceEvidence(provider="fixture", work_id=None, edition_id=None)],
    )


class Response:
    def __init__(self, body: bytes, content_type: str = "image/jpeg", status: int = 200):
        self.content = body
        self.headers = {"content-type": content_type, "content-length": str(len(body))}
        self.status_code = status


class Client:
    def __init__(self, response: Response | Exception):
        self.response = response
        self.requested = []

    async def get(self, url: str):
        self.requested.append(url)
        if isinstance(self.response, Exception):
            raise self.response
        return self.response


@pytest.mark.anyio
async def test_comparator_scores_candidate_cover_without_persisting_either_image():
    original = image_bytes()
    client = Client(Response(original))
    comparator = HttpCoverComparator(client=client, allowed_hosts={"covers.example"})

    score = await comparator.compare(original, candidate("https://covers.example/book.jpg"))

    assert score == pytest.approx(1.0)
    assert client.requested == ["https://covers.example/book.jpg"]


@pytest.mark.anyio
async def test_comparator_safely_ignores_missing_bad_or_oversized_cover_responses():
    original = image_bytes()
    options = {"allowed_hosts": {"covers.example"}}
    assert (
        await HttpCoverComparator(client=Client(Response(b"bad", "text/html")), **options).compare(
            original, candidate("https://covers.example/book.jpg")
        )
        is None
    )
    assert (
        await HttpCoverComparator(
            client=Client(Response(b"x" * 101)), max_bytes=100, **options
        ).compare(original, candidate("https://covers.example/book.jpg"))
        is None
    )
    assert (
        await HttpCoverComparator(client=Client(RuntimeError("offline")), **options).compare(
            original, candidate("https://covers.example/book.jpg")
        )
        is None
    )
    assert (
        await HttpCoverComparator(client=Client(Response(original)), **options).compare(
            original, candidate(None)
        )
        is None
    )


@pytest.mark.anyio
async def test_comparator_refuses_non_allowlisted_or_insecure_cover_hosts():
    client = Client(Response(image_bytes()))
    comparator = HttpCoverComparator(client=client)

    assert (
        await comparator.compare(image_bytes(), candidate("https://private.example/internal.jpg"))
        is None
    )
    assert (
        await comparator.compare(image_bytes(), candidate("http://covers.openlibrary.org/book.jpg"))
        is None
    )
    assert client.requested == []
