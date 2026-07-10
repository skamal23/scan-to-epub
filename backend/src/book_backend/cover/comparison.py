from urllib.parse import urlparse

import httpx
from PIL import Image

from book_backend.metadata.models import MetadataCandidate

from .ocr import CoverImage, difference_hash


class HttpCoverComparator:
    def __init__(
        self,
        client=None,
        max_bytes: int = 1_000_000,
        timeout_seconds: float = 4,
        allowed_hosts: set[str] | None = None,
    ):
        self.client = client
        self.max_bytes = max_bytes
        self.timeout_seconds = timeout_seconds
        self.allowed_hosts = allowed_hosts or {
            "books.google.com",
            "books.googleusercontent.com",
            "covers.openlibrary.org",
        }

    async def compare(
        self,
        image_bytes: bytes,
        candidate: MetadataCandidate,
    ) -> float | None:
        url = candidate.edition.cover_url
        parsed = urlparse(url or "")
        if parsed.scheme != "https" or parsed.hostname not in self.allowed_hosts:
            return None
        try:
            status, headers, content = await self._get(url)
            if status != 200:
                return None
            content_type = headers.get("content-type", "").partition(";")[0].lower()
            if content_type not in {"image/jpeg", "image/png", "image/webp"}:
                return None
            content_length = headers.get("content-length")
            if content_length and int(content_length) > self.max_bytes:
                return None
            if len(content) > self.max_bytes:
                return None
            observed = CoverImage.decode(image_bytes).image
            reference = CoverImage.decode(content, max_pixels=8_000_000).image
        except (httpx.HTTPError, OSError, RuntimeError, ValueError):
            return None
        observed_hash = difference_hash(_center_crop(observed))
        reference_hash = difference_hash(_center_crop(reference))
        distance = (observed_hash ^ reference_hash).bit_count()
        return 1 - distance / 64

    async def _get(self, url: str):
        if self.client is not None:
            response = await self.client.get(url)
            return response.status_code, response.headers, response.content
        timeout = httpx.Timeout(self.timeout_seconds)
        async with (
            httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client,
            client.stream(
                "GET",
                url,
                headers={"Accept": "image/avif,image/webp,image/*"},
            ) as response,
        ):
            content_length = response.headers.get("content-length")
            if content_length and int(content_length) > self.max_bytes:
                return response.status_code, response.headers, b""
            body = bytearray()
            async for chunk in response.aiter_bytes():
                body.extend(chunk)
                if len(body) > self.max_bytes:
                    body.clear()
                    return response.status_code, response.headers, b""
            return response.status_code, response.headers, bytes(body)


def _center_crop(image: Image.Image) -> Image.Image:
    width, height = image.size
    target_ratio = 2 / 3
    current_ratio = width / max(height, 1)
    if current_ratio > target_ratio:
        target_width = round(height * target_ratio)
        left = (width - target_width) // 2
        return image.crop((left, 0, left + target_width, height))
    target_height = round(width / target_ratio)
    top = max((height - target_height) // 2, 0)
    return image.crop((0, top, width, min(top + target_height, height)))
