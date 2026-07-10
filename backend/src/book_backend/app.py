import asyncio
import logging
from typing import Protocol
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request

from .config import Settings
from .cover.comparison import HttpCoverComparator
from .cover.models import CoverRecognitionResult
from .cover.ocr import TesseractCoverOcr
from .cover.service import CoverRecognitionService
from .metadata.models import MetadataSearchRequest, MetadataSearchResult
from .metadata.providers import (
    FixtureFailureProvider,
    FixtureMetadataProvider,
    GoogleBooksProvider,
    OpenLibraryProvider,
)
from .metadata.service import MetadataSearchService

REQUEST_LOGGER = logging.getLogger("book_backend.request")


class CoverRecognizer(Protocol):
    async def recognize(self, image_bytes: bytes) -> CoverRecognitionResult: ...


def create_app(
    settings: Settings,
    metadata_service: MetadataSearchService | None = None,
    cover_recognizer: CoverRecognizer | None = None,
) -> FastAPI:
    app = FastAPI(title="Book Backend", version="0.1.0")
    if metadata_service is None:
        providers = (
            [FixtureMetadataProvider(), FixtureFailureProvider()]
            if settings.fixture_mode
            else [
                OpenLibraryProvider(
                    user_agent=(
                        f"BookToEPUB/0.1 ({settings.contact_email})"
                        if settings.contact_email
                        else "BookToEPUB/0.1"
                    ),
                    requests_per_second=3 if settings.contact_email else 1,
                )
            ]
        )
        if not settings.fixture_mode and settings.google_books_api_key:
            providers.append(GoogleBooksProvider(api_key=settings.google_books_api_key))
        metadata_service = MetadataSearchService(providers=providers)
    if cover_recognizer is None:
        cover_recognizer = CoverRecognitionService(
            ocr=TesseractCoverOcr(),
            metadata=metadata_service,
            comparator=HttpCoverComparator(),
        )

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        request_id = request.headers.get("x-request-id") or str(uuid4())
        response = await call_next(request)
        response.headers["x-request-id"] = request_id
        REQUEST_LOGGER.info(
            "%s %s %s",
            request.method,
            request.url.path,
            response.status_code,
        )
        return response

    @app.get("/health")
    async def health() -> dict[str, str | bool]:
        return {
            "status": "ok",
            "service": "book-backend",
            "environment": settings.environment,
            "fixtureMode": settings.fixture_mode,
            "version": "0.1.0",
        }

    @app.post("/metadata/search", response_model=MetadataSearchResult)
    async def search_metadata(request: MetadataSearchRequest) -> MetadataSearchResult:
        return await metadata_service.search(request.to_query())

    @app.post("/covers/recognize", response_model=CoverRecognitionResult)
    async def recognize_cover(request: Request) -> CoverRecognitionResult:
        content_type = request.headers.get("content-type", "").partition(";")[0].strip().lower()
        if content_type not in {"image/jpeg", "image/png"}:
            raise HTTPException(status_code=415, detail="Send a JPEG or PNG cover image")
        content_length = request.headers.get("content-length")
        if content_length and int(content_length) > settings.cover_max_bytes:
            raise HTTPException(status_code=413, detail="Cover image is too large")
        image_bytes = bytearray()
        async for chunk in request.stream():
            image_bytes.extend(chunk)
            if len(image_bytes) > settings.cover_max_bytes:
                image_bytes.clear()
                raise HTTPException(status_code=413, detail="Cover image is too large")
        if not image_bytes:
            raise HTTPException(status_code=422, detail="The cover image could not be read")
        try:
            return await asyncio.wait_for(
                cover_recognizer.recognize(bytes(image_bytes)),
                timeout=settings.cover_timeout_seconds,
            )
        except TimeoutError as error:
            raise HTTPException(status_code=504, detail="Cover recognition timed out") from error
        except ValueError as error:
            raise HTTPException(
                status_code=422,
                detail="The cover image could not be read",
            ) from error
        except RuntimeError as error:
            raise HTTPException(
                status_code=503,
                detail="Cover recognition is unavailable",
            ) from error
        finally:
            image_bytes.clear()

    return app


app = create_app(Settings.from_env())
