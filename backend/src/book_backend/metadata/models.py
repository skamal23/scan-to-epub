from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel, ConfigDict, model_validator

from .isbn import normalize_isbn


def to_camel(value: str) -> str:
    first, *rest = value.split("_")
    return first + "".join(part.capitalize() for part in rest)


class APIModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


@dataclass(frozen=True, slots=True)
class MetadataQuery:
    isbn: str | None = None
    title: str | None = None
    author: str | None = None


@dataclass(frozen=True, slots=True)
class BookRecord:
    provider: str
    provider_work_id: str | None
    provider_edition_id: str | None
    title: str
    authors: tuple[str, ...]
    first_published_year: int | None
    published_date: str | None
    publisher: str | None
    language: str | None
    isbn10: str | None
    isbn13: str | None
    cover_url: str | None


class MetadataSearchRequest(APIModel):
    isbn: str | None = None
    title: str | None = None
    author: str | None = None

    @model_validator(mode="after")
    def validate_query(self):
        self.isbn = self.isbn.strip() if self.isbn else None
        self.title = self.title.strip() if self.title else None
        self.author = self.author.strip() if self.author else None
        if self.isbn and (self.title or self.author):
            raise ValueError("Search by ISBN or by title and author, not both")
        if self.isbn:
            self.isbn = normalize_isbn(self.isbn)
        elif not self.title:
            raise ValueError("Enter an ISBN or title")
        return self

    def to_query(self) -> MetadataQuery:
        return MetadataQuery(isbn=self.isbn, title=self.title, author=self.author)


class SourceEvidence(APIModel):
    provider: str
    work_id: str | None
    edition_id: str | None


class WorkSummary(APIModel):
    title: str
    authors: list[str]
    first_published_year: int | None
    language: str | None
    source_ids: dict[str, str]


class EditionSummary(APIModel):
    title: str
    publisher: str | None
    published_date: str | None
    isbn10: str | None
    isbn13: str | None
    cover_url: str | None
    source_ids: dict[str, str]


class MetadataCandidate(APIModel):
    candidate_id: str
    confidence: Literal["high", "medium", "low"]
    match_reasons: list[str]
    work: WorkSummary
    edition: EditionSummary
    sources: list[SourceEvidence]


class MetadataSearchResult(APIModel):
    observed_isbn: str | None
    candidates: list[MetadataCandidate]
    provider_failures: list[str]
