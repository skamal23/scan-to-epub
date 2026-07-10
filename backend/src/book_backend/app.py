import logging
from uuid import uuid4

from fastapi import FastAPI, Request

from .config import Settings

REQUEST_LOGGER = logging.getLogger("book_backend.request")


def create_app(settings: Settings) -> FastAPI:
    app = FastAPI(title="Book Backend", version="0.1.0")

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

    return app


app = create_app(Settings.from_env())
