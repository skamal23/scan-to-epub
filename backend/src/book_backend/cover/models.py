from dataclasses import dataclass
from typing import Literal

from book_backend.metadata.models import APIModel, MetadataCandidate


@dataclass(frozen=True, slots=True)
class OcrLine:
    text: str
    confidence: float
    top: int
    height: int


class CoverRecognitionResult(APIModel):
    status: Literal["matched", "ambiguous", "no_match"]
    confidence: Literal["high", "medium", "low"]
    extracted_title: str | None = None
    extracted_author: str | None = None
    candidates: list[MetadataCandidate]
    provider_failures: list[str]
