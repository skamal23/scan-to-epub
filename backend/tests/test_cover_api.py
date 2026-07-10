import asyncio

from fastapi.testclient import TestClient

from book_backend.app import create_app
from book_backend.config import Settings
from book_backend.cover.models import CoverRecognitionResult


class StubCoverRecognizer:
    def __init__(
        self,
        result: CoverRecognitionResult | None = None,
        error: Exception | None = None,
    ):
        self.result = result or CoverRecognitionResult(
            status="no_match",
            confidence="low",
            candidates=[],
            provider_failures=[],
        )
        self.error = error
        self.received: bytes | None = None

    async def recognize(self, image_bytes: bytes) -> CoverRecognitionResult:
        self.received = image_bytes
        if self.error:
            raise self.error
        return self.result


def settings(**overrides) -> Settings:
    values = {
        "environment": "test",
        "fixture_mode": True,
        "google_books_api_key": None,
        "contact_email": None,
        "cover_max_bytes": 32,
        "cover_timeout_seconds": 0.05,
    }
    values.update(overrides)
    return Settings(**values)


def test_cover_endpoint_accepts_only_bounded_jpeg_or_png_bytes():
    recognizer = StubCoverRecognizer()
    client = TestClient(create_app(settings(), cover_recognizer=recognizer))

    response = client.post(
        "/covers/recognize",
        content=b"small-jpeg",
        headers={"content-type": "image/jpeg"},
    )

    assert response.status_code == 200
    assert response.json()["status"] == "no_match"
    assert recognizer.received == b"small-jpeg"


def test_cover_endpoint_rejects_wrong_media_type_without_invoking_recognition():
    recognizer = StubCoverRecognizer()
    client = TestClient(create_app(settings(), cover_recognizer=recognizer))

    response = client.post(
        "/covers/recognize",
        content=b"not-an-image",
        headers={"content-type": "application/octet-stream"},
    )

    assert response.status_code == 415
    assert recognizer.received is None


def test_cover_endpoint_rejects_content_length_and_stream_over_limit():
    recognizer = StubCoverRecognizer()
    client = TestClient(create_app(settings(cover_max_bytes=8), cover_recognizer=recognizer))

    response = client.post(
        "/covers/recognize",
        content=b"0123456789",
        headers={"content-type": "image/png"},
    )

    assert response.status_code == 413
    assert recognizer.received is None


def test_cover_endpoint_maps_corrupt_images_to_a_safe_client_error():
    recognizer = StubCoverRecognizer(error=ValueError("decoded pixels are corrupt"))
    client = TestClient(create_app(settings(), cover_recognizer=recognizer))

    response = client.post(
        "/covers/recognize",
        content=b"bad-image",
        headers={"content-type": "image/jpeg"},
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "The cover image could not be read"
    assert "pixels" not in response.text


def test_cover_endpoint_hides_internal_ocr_failures():
    recognizer = StubCoverRecognizer(error=RuntimeError("tesseract binary leaked details"))
    client = TestClient(create_app(settings(), cover_recognizer=recognizer))

    response = client.post(
        "/covers/recognize",
        content=b"image",
        headers={"content-type": "image/jpeg"},
    )

    assert response.status_code == 503
    assert response.json()["detail"] == "Cover recognition is unavailable"
    assert "tesseract" not in response.text


def test_cover_endpoint_times_out_without_returning_image_or_ocr_data():
    class SlowRecognizer:
        async def recognize(self, image_bytes: bytes) -> CoverRecognitionResult:
            await asyncio.sleep(0.2)
            raise AssertionError("unreachable")

    client = TestClient(create_app(settings(), cover_recognizer=SlowRecognizer()))

    response = client.post(
        "/covers/recognize",
        content=b"slow-image",
        headers={"content-type": "image/jpeg"},
    )

    assert response.status_code == 504
    assert response.json()["detail"] == "Cover recognition timed out"
    assert "slow-image" not in response.text
