import asyncio
import logging
from typing import Protocol
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request, Response

from .config import Settings
from .content_sources.catalog import (
    APPROVED_EPUB_CATALOG,
    APPROVED_PDF_CATALOG,
    APPROVED_STRUCTURED_CATALOG,
)
from .content_sources.google_books import (
    GoogleBooksOpenEditionSource,
    HttpGoogleBooksVolumeClient,
)
from .content_sources.gutenberg import (
    HttpProjectGutenbergOpdsClient,
    ProjectGutenbergOpenEditionSource,
)
from .content_sources.standard_ebooks import (
    HttpStandardEbooksClient,
    StandardEbooksOpenEditionSource,
)
from .cover.comparison import HttpCoverComparator
from .cover.models import CoverRecognitionResult
from .cover.ocr import TesseractCoverOcr
from .cover.service import CoverRecognitionService
from .editions.acquisition import HttpEpubFetcher, SafeEpubAcquirer
from .editions.errors import SourceUnavailable, ValidationFailed
from .editions.fixtures import FixtureEditionResolutionService
from .editions.models import EditionResolutionResult, EditionResolveRequest
from .editions.service import EditionResolutionService
from .epubs.artifacts import EphemeralEpubStore
from .epubs.validator import EpubcheckValidator
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


class EditionResolver(Protocol):
    async def resolve(self, request: EditionResolveRequest) -> EditionResolutionResult: ...


def _live_dynamic_sources(settings: Settings, user_agent: str) -> tuple[object, ...]:
    sources: list[object] = [
        StandardEbooksOpenEditionSource(
            client=HttpStandardEbooksClient(user_agent=user_agent),
        ),
        ProjectGutenbergOpenEditionSource(
            client=HttpProjectGutenbergOpdsClient(user_agent=user_agent),
        ),
    ]
    if settings.google_books_api_key:
        sources.append(
            GoogleBooksOpenEditionSource(
                client=HttpGoogleBooksVolumeClient(settings.google_books_api_key)
            )
        )
    return tuple(sources)


def _cover_content_length(request: Request) -> int | None:
    value = request.headers.get("content-length")
    if value is None:
        return None
    if not value.isascii() or not value.isdecimal():
        raise HTTPException(status_code=400, detail="Cover size could not be read")
    return int(value)


def create_app(
    settings: Settings,
    metadata_service: MetadataSearchService | None = None,
    cover_recognizer: CoverRecognizer | None = None,
    edition_service: EditionResolver | None = None,
    epub_store: EphemeralEpubStore | None = None,
) -> FastAPI:
    app = FastAPI(title="Book Backend", version="0.1.0")
    epub_store = epub_store or EphemeralEpubStore(ttl_seconds=settings.epub_artifact_ttl_seconds)
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
    if edition_service is None:
        if settings.fixture_mode:
            edition_service = FixtureEditionResolutionService(artifact_store=epub_store)
        else:
            user_agent = (
                f"BookToEPUB/0.1 ({settings.contact_email})"
                if settings.contact_email
                else "BookToEPUB/0.1"
            )
            edition_service = EditionResolutionService(
                catalog=APPROVED_EPUB_CATALOG,
                acquirer=SafeEpubAcquirer(HttpEpubFetcher(user_agent=user_agent)),
                validator=EpubcheckValidator(),
                artifact_store=epub_store,
                dynamic_sources=_live_dynamic_sources(settings, user_agent),
                structured_catalog=APPROVED_STRUCTURED_CATALOG,
                pdf_catalog=APPROVED_PDF_CATALOG,
            )

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        request_id = str(uuid4())
        response = await call_next(request)
        response.headers.update(
            {
                "Cache-Control": "no-store",
                "Referrer-Policy": "no-referrer",
                "X-Content-Type-Options": "nosniff",
                "X-Request-ID": request_id,
            }
        )
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
        content_length = _cover_content_length(request)
        if content_length is not None and content_length > settings.cover_max_bytes:
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

    @app.post("/editions/resolve", response_model=EditionResolutionResult)
    async def resolve_edition(request: EditionResolveRequest) -> EditionResolutionResult:
        try:
            return await edition_service.resolve(request)
        except SourceUnavailable as error:
            raise HTTPException(
                status_code=503,
                detail="The open-edition source is unavailable",
            ) from error
        except ValidationFailed as error:
            raise HTTPException(
                status_code=502,
                detail="The open edition could not be verified",
            ) from error

    @app.get("/editions/download")
    async def download_epub(request: Request) -> Response:
        authorization = request.headers.get("authorization", "")
        scheme, _, token = authorization.partition(" ")
        if scheme.casefold() != "bearer" or not token:
            raise HTTPException(status_code=401, detail="A download credential is required")
        artifact = await epub_store.get(token)
        if artifact is None:
            raise HTTPException(status_code=410, detail="The EPUB is no longer available")
        return Response(
            content=bytes(artifact.content),
            media_type="application/epub+zip",
            headers={
                "Cache-Control": "no-store",
                "Content-Disposition": f'attachment; filename="{artifact.filename}"',
                "Content-Length": str(len(artifact.content)),
                "X-Content-SHA256": artifact.sha256,
                "X-Content-Type-Options": "nosniff",
            },
        )

    return app


app = create_app(Settings.from_env())
