from typing import Protocol

from book_backend.content_sources.approved_catalog import ApprovedEpubEntry
from book_backend.epubs.artifacts import EpubDelivery
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
    EpubDeliveryInfo,
    PhysicalEditionInfo,
)


class EpubAcquirer(Protocol):
    async def acquire(self, entry: ApprovedEpubEntry) -> AcquiredEpub: ...


class EpubValidator(Protocol):
    async def validate(self, content: bytes) -> EpubcheckResult: ...


class EpubArtifactStore(Protocol):
    async def stage(
        self, content: bytes, sha256: str, title: str, authors: list[str]
    ) -> EpubDelivery: ...


class ReviewedCatalog(Protocol):
    def find_all(
        self,
        title: str,
        authors: list[str],
        physical_isbn13: str | None,
    ) -> tuple[ApprovedEpubEntry, ...]: ...


class DynamicReviewedCatalog(Protocol):
    async def find_all(
        self,
        title: str,
        authors: list[str],
        physical_isbn13: str | None,
    ) -> tuple[ApprovedEpubEntry, ...]: ...


class EditionResolutionService:
    def __init__(
        self,
        catalog: ReviewedCatalog,
        acquirer: EpubAcquirer,
        validator: EpubValidator,
        artifact_store: EpubArtifactStore,
        dynamic_sources: tuple[DynamicReviewedCatalog, ...] = (),
    ):
        self.catalog = catalog
        self.acquirer = acquirer
        self.validator = validator
        self.artifact_store = artifact_store
        self.dynamic_sources = dynamic_sources

    async def resolve(self, request: EditionResolveRequest) -> EditionResolutionResult:
        entries = await self._find_entries(request)
        if not entries:
            return EditionResolutionResult(
                status="unavailable",
                reason="No reviewed open edition is available for this work yet.",
                physical_edition=_physical_edition(request),
            )
        source_unavailable: SourceUnavailable | None = None
        validation_failed: ValidationFailed | None = None
        rights_eligible = False
        source_attempts: list[str] = []
        for entry in entries:
            decision = decide_rights(entry.rights_evidence, "existing_epub", request.territory)
            if decision.outcome != "deliver":
                continue
            rights_eligible = True
            if entry.source_organization not in source_attempts:
                source_attempts.append(entry.source_organization)
            try:
                return await self._deliver(entry, request, source_attempts)
            except SourceUnavailable as error:
                source_unavailable = error
            except ValidationFailed as error:
                validation_failed = error

        if validation_failed is not None:
            raise validation_failed
        if source_unavailable is not None:
            raise source_unavailable
        if not rights_eligible:
            return EditionResolutionResult(
                status="unavailable",
                reason="The available source did not pass the demo's rights policy.",
                physical_edition=_physical_edition(request),
            )
        return EditionResolutionResult(
            status="unavailable",
            reason="No reviewed open edition is available for this work yet.",
            physical_edition=_physical_edition(request),
        )

    async def _find_entries(self, request: EditionResolveRequest) -> tuple[ApprovedEpubEntry, ...]:
        static_entries = self.catalog.find_all(
            request.work_title,
            request.work_authors,
            request.physical_isbn13,
        )
        if static_entries:
            return static_entries

        entries: list[ApprovedEpubEntry] = []
        source_failure: SourceUnavailable | None = None
        for source in self.dynamic_sources:
            try:
                entries.extend(
                    await source.find_all(
                        request.work_title,
                        request.work_authors,
                        request.physical_isbn13,
                    )
                )
            except SourceUnavailable as error:
                source_failure = error
        if entries:
            return _distinct_by_digital_identifier(entries)
        if source_failure is not None:
            raise source_failure
        return ()

    async def _deliver(
        self,
        entry: ApprovedEpubEntry,
        request: EditionResolveRequest,
        source_attempts: list[str],
    ) -> EditionResolutionResult:
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
        try:
            delivery = await self.artifact_store.stage(
                content=acquired.content,
                sha256=acquired.sha256,
                title=entry.digital_title,
                authors=list(entry.authors),
            )
        except ValueError as error:
            raise ValidationFailed(
                "The verified EPUB could not be prepared for delivery"
            ) from error
        return EditionResolutionResult(
            status="ready",
            physical_edition=_physical_edition(request),
            digital_edition=DigitalEditionInfo(
                title=entry.digital_title,
                authors=list(entry.authors),
                language=entry.language,
                identifier=entry.digital_identifier,
                publisher=entry.publisher,
                cover_url=entry.cover_url,
                is_same_publication=False,
            ),
            source=EditionSourceInfo(
                organization=entry.source_organization,
                canonical_url=entry.canonical_url,
            ),
            rights=EditionRightsInfo(
                license_name=entry.license_name,
                license_url=entry.license_url,
                rights_statement=entry.rights_statement,
                attribution=entry.attribution,
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
                source_attempts=source_attempts,
            ),
            delivery=EpubDeliveryInfo(
                download_path=delivery.download_path,
                download_token=delivery.download_token,
                filename=delivery.filename,
                content_length=delivery.content_length,
                sha256=delivery.sha256,
                expires_at=delivery.expires_at,
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


def _distinct_by_digital_identifier(
    entries: list[ApprovedEpubEntry],
) -> tuple[ApprovedEpubEntry, ...]:
    seen: set[str] = set()
    result: list[ApprovedEpubEntry] = []
    for entry in sorted(entries, key=lambda item: (item.priority, item.entry_id)):
        identifier = entry.digital_identifier.rstrip("/").casefold()
        if identifier in seen:
            continue
        seen.add(identifier)
        result.append(entry)
    return tuple(result)


__all__ = [
    "AcquiredEpub",
    "EditionResolutionService",
    "SourceUnavailable",
    "ValidationFailed",
]
