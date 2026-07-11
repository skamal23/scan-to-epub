from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from pydantic import Field, model_validator

from book_backend.metadata.models import APIModel


@dataclass(frozen=True, slots=True)
class AcquiredEpub:
    content: bytes
    sha256: str
    retrieved_at: datetime


class EditionResolveRequest(APIModel):
    candidate_id: str
    work_title: str
    work_authors: list[str]
    physical_isbn13: str | None = None
    physical_publisher: str | None = None
    physical_published_date: str | None = None
    work_source_ids: dict[str, str] = Field(default_factory=dict)
    edition_source_ids: dict[str, str] = Field(default_factory=dict)
    territory: Literal["US"] = "US"


class PhysicalEditionInfo(APIModel):
    candidate_id: str
    title: str
    authors: list[str]
    isbn13: str | None
    publisher: str | None
    published_date: str | None
    source_ids: dict[str, str]


class DigitalEditionInfo(APIModel):
    title: str
    authors: list[str]
    language: str
    identifier: str
    publisher: str
    cover_url: str | None
    is_same_publication: bool


class EditionSourceInfo(APIModel):
    organization: str
    canonical_url: str


class EditionRightsInfo(APIModel):
    license_name: str
    license_url: str
    rights_statement: str
    attribution: str | None = None
    territory: str


class EditionProvenance(APIModel):
    catalog_entry_id: str
    catalog_reviewed_at: str
    acquisition_url: str
    retrieved_at: datetime
    original_sha256: str
    final_sha256: str
    transformation: Literal["unchanged", "generated"]
    epubcheck_version: str
    epubcheck_status: Literal["valid"]
    epubcheck_warnings: list[str]
    source_attempts: list[str]
    generated_at: datetime | None = None
    generator_version: str | None = None
    transformation_steps: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_transformation_metadata(self):
        if self.transformation == "generated":
            if (
                self.generated_at is None
                or not self.generator_version
                or not self.transformation_steps
            ):
                raise ValueError("Generated provenance must include conversion metadata")
        elif (
            self.generated_at is not None
            or self.generator_version is not None
            or self.transformation_steps
        ):
            raise ValueError("Unchanged provenance cannot include conversion metadata")
        return self


class EpubDeliveryInfo(APIModel):
    download_path: str
    download_token: str
    filename: str
    content_length: int
    sha256: str
    expires_at: datetime


class EditionResolutionResult(APIModel):
    status: Literal["ready", "unavailable"]
    reason: str | None = None
    physical_edition: PhysicalEditionInfo | None = None
    digital_edition: DigitalEditionInfo | None = None
    source: EditionSourceInfo | None = None
    rights: EditionRightsInfo | None = None
    provenance: EditionProvenance | None = None
    delivery: EpubDeliveryInfo | None = None
