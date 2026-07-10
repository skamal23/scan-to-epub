from typing import Protocol

from book_backend.content_sources.standard_ebooks import StandardEbooksCatalog
from book_backend.epubs.safety import InvalidEpub, inspect_epub
from book_backend.epubs.validator import EpubcheckResult
from book_backend.rights.policy import decide_rights

from .errors import SourceUnavailable, ValidationFailed
from .models import (
    AcquiredEpub,
    DigitalEditionInfo,
    EditionProvenance,
    EditionResolutionResult,
    EditionResolveRequest,
    EditionRightsInfo,
    EditionSourceInfo,
    PhysicalEditionInfo,
)


class EpubAcquirer(Protocol):
    async def acquire(self, entry) -> AcquiredEpub: ...


class EpubValidator(Protocol):
    async def validate(self, content: bytes) -> EpubcheckResult: ...


class EditionResolutionService:
    def __init__(
        self, catalog: StandardEbooksCatalog, acquirer: EpubAcquirer, validator: EpubValidator
    ):
        self.catalog = catalog
        self.acquirer = acquirer
        self.validator = validator

    async def resolve(self, request: EditionResolveRequest) -> EditionResolutionResult:
        entry = self.catalog.find(
            request.work_title,
            request.work_authors,
            request.physical_isbn13,
        )
        if entry is None:
            return EditionResolutionResult(
                status="unavailable",
                reason="No reviewed open edition is available for this work yet.",
                physical_edition=_physical_edition(request),
            )
        decision = decide_rights(entry.rights_evidence, "existing_epub", request.territory)
        if decision.outcome != "deliver":
            return EditionResolutionResult(
                status="unavailable",
                reason="The available source did not pass the demo's rights policy.",
                physical_edition=_physical_edition(request),
            )
        acquired = await self.acquirer.acquire(entry)
        try:
            inspect_epub(acquired.content)
        except InvalidEpub as error:
            raise ValidationFailed(str(error)) from error
        try:
            validation = await self.validator.validate(acquired.content)
        except RuntimeError as error:
            raise ValidationFailed("EPUB conformance validation could not run") from error
        if not validation.valid:
            raise ValidationFailed("EPUBCheck found conformance errors")
        return EditionResolutionResult(
            status="ready",
            physical_edition=_physical_edition(request),
            digital_edition=DigitalEditionInfo(
                title=entry.digital_title,
                authors=list(entry.authors[:1]),
                language=entry.language,
                identifier=entry.digital_identifier,
                publisher="Standard Ebooks",
                cover_url=entry.cover_url,
                is_same_publication=False,
            ),
            source=EditionSourceInfo(
                organization="Standard Ebooks",
                canonical_url=entry.canonical_url,
            ),
            rights=EditionRightsInfo(
                license_name="CC0 1.0 Universal",
                license_url="https://creativecommons.org/publicdomain/zero/1.0/",
                rights_statement=(
                    "Standard Ebooks represents the text and cover as public domain in the U.S. "
                    "and dedicates its edition work to the public domain via CC0."
                ),
                territory=request.territory,
            ),
            provenance=EditionProvenance(
                catalog_entry_id=entry.entry_id,
                catalog_reviewed_at=entry.reviewed_at,
                acquisition_url=entry.acquisition_url,
                retrieved_at=acquired.retrieved_at,
                original_sha256=acquired.sha256,
                final_sha256=acquired.sha256,
                transformation="unchanged",
                epubcheck_version=validation.version,
                epubcheck_status="valid",
                epubcheck_warnings=validation.warnings,
            ),
        )


def _physical_edition(request: EditionResolveRequest) -> PhysicalEditionInfo:
    return PhysicalEditionInfo(
        candidate_id=request.candidate_id,
        title=request.work_title,
        authors=request.work_authors,
        isbn13=request.physical_isbn13,
        publisher=request.physical_publisher,
        published_date=request.physical_published_date,
        source_ids=request.edition_source_ids,
    )


__all__ = [
    "AcquiredEpub",
    "EditionResolutionService",
    "SourceUnavailable",
    "ValidationFailed",
]
