import asyncio
import hashlib
import re
import secrets
import unicodedata
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta


@dataclass(frozen=True, slots=True)
class EpubDelivery:
    download_path: str
    download_token: str
    filename: str
    content_length: int
    sha256: str
    expires_at: datetime


@dataclass(slots=True)
class StoredEpub:
    content: bytearray
    filename: str
    sha256: str
    expires_at: datetime


class EphemeralEpubStore:
    """An in-memory, short-lived store for EPUBs already validated by the resolver."""

    download_path = "/editions/download"

    def __init__(
        self,
        ttl_seconds: int = 600,
        now: Callable[[], datetime] | None = None,
    ):
        if ttl_seconds <= 0:
            raise ValueError("EPUB artifact TTL must be positive")
        self.ttl = timedelta(seconds=ttl_seconds)
        self.now = now or (lambda: datetime.now(UTC))
        self._artifacts: dict[str, StoredEpub] = {}
        self._lock = asyncio.Lock()

    async def stage(
        self,
        content: bytes,
        sha256: str,
        title: str,
        authors: list[str],
    ) -> EpubDelivery:
        if hashlib.sha256(content).hexdigest() != sha256:
            raise ValueError("Only a hash-verified EPUB can be staged")
        expires_at = self.now() + self.ttl
        token = secrets.token_urlsafe(32)
        filename = safe_epub_filename(title, authors)
        stored = StoredEpub(
            content=bytearray(content),
            filename=filename,
            sha256=sha256,
            expires_at=expires_at,
        )
        async with self._lock:
            self._purge_expired_locked()
            self._artifacts[token] = stored
        return EpubDelivery(
            download_path=self.download_path,
            download_token=token,
            filename=filename,
            content_length=len(content),
            sha256=sha256,
            expires_at=expires_at,
        )

    async def get(self, token: str) -> StoredEpub | None:
        async with self._lock:
            self._purge_expired_locked()
            artifact = self._artifacts.get(token)
            if artifact is None:
                return None
            return StoredEpub(
                content=bytearray(artifact.content),
                filename=artifact.filename,
                sha256=artifact.sha256,
                expires_at=artifact.expires_at,
            )

    def _purge_expired_locked(self) -> None:
        now = self.now()
        expired = [
            token for token, artifact in self._artifacts.items() if artifact.expires_at <= now
        ]
        for token in expired:
            artifact = self._artifacts.pop(token)
            artifact.content.clear()


def safe_epub_filename(title: str, authors: list[str]) -> str:
    title_part = _safe_part(title) or "book"
    author_part = _safe_part(authors[0]) if authors else ""
    base = "-".join(part for part in (title_part, author_part or "book") if part)
    return f"{base[:120].rstrip('-') or 'book'}.epub"


def _safe_part(value: str) -> str:
    ascii_value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    return "-".join(re.findall(r"[A-Za-z0-9]+", ascii_value))
