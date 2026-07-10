import logging
from uuid import uuid4

from fastapi import FastAPI, Request

from .config import Settings
from .metadata.models import MetadataSearchRequest, MetadataSearchResult
from .metadata.providers import (
    FixtureFailureProvider,
    FixtureMetadataProvider,
    GoogleBooksProvider,
    OpenLibraryProvider,
)
from .metadata.service import MetadataSearchService

REQUEST_LOGGER = logging.getLogger("book_backend.request")


def create_app(
    settings: Settings,
    metadata_service: MetadataSearchService | None = None,
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

    return app


app = create_app(Settings.from_env())
