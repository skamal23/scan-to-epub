import hashlib
from datetime import UTC, datetime
from typing import Protocol

from book_backend.content_sources.approved_catalog import (
    ApprovedEpubEntry,
    ApprovedStructuredEntry,
)
from book_backend.epubs.artifacts import EpubDelivery
from book_backend.epubs.generation import GenerationRejected, StructuredSource, generate_epub
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


class ReviewedStructuredCatalog(Protocol):
    def find_all(
        self,
        title: str,
        authors: list[str],
        physical_isbn13: str | None,
    ) -> tuple[ApprovedStructuredEntry, ...]: ...


class EditionResolutionService:
    def __init__(
        self,
        catalog: ReviewedCatalog,
        acquirer: EpubAcquirer,
        validator: EpubValidator,
        artifact_store: EpubArtifactStore,
        dynamic_sources: tuple[DynamicReviewedCatalog, ...] = (),
        structured_catalog: ReviewedStructuredCatalog | None = None,
    ):
        self.catalog = catalog
        self.acquirer = acquirer
        self.validator = validator
        self.artifact_store = artifact_store
        self.dynamic_sources = dynamic_sources
        self.structured_catalog = structured_catalog

    async def resolve(self, request: EditionResolveRequest) -> EditionResolutionResult:
        source_unavailable: SourceUnavailable | None = None
        try:
            entries = await self._find_entries(request)
        except SourceUnavailable as error:
            # A reviewed structured snapshot may still provide a fully local,
            # rights-cleared fallback when dynamic EPUB discovery is offline.
            entries = ()
            source_unavailable = error
        validation_failed: ValidationFailed | None = None
        rights_eligible = False
        source_attempts: list[str] = []
        for entry in entries:
            if entry.source_organization not in source_attempts:
                source_attempts.append(entry.source_organization)
            decision = decide_rights(entry.rights_evidence, "existing_epub", request.territory)
            if decision.outcome != "deliver":
                continue
            rights_eligible = True
            try:
                return await self._deliver(entry, request, source_attempts)
            except SourceUnavailable as error:
                source_unavailable = error
            except ValidationFailed as error:
                validation_failed = error

        generated_fallback = await self._generate_from_structured_source(
            request,
            prior_source_attempts=source_attempts,
        )
        if generated_fallback.status == "ready":
            return generated_fallback
        if validation_failed is not None:
            raise validation_failed
        if source_unavailable is not None:
            raise source_unavailable
        if entries and not rights_eligible:
            return EditionResolutionResult(
                status="unavailable",
                reason="The available source did not pass the demo's rights policy.",
                physical_edition=_physical_edition(request),
            )
        return generated_fallback

    async def _generate_from_structured_source(
        self,
        request: EditionResolveRequest,
        *,
        prior_source_attempts: list[str] | None = None,
    ) -> EditionResolutionResult:
        if self.structured_catalog is None:
            return _no_open_edition(request)
        entries = self.structured_catalog.find_all(
            request.work_title,
            request.work_authors,
            request.physical_isbn13,
        )
        if not entries:
            return _no_open_edition(request)

        source_attempts = list(prior_source_attempts or ())
        rights_eligible = False
        validation_failed: ValidationFailed | None = None
        for entry in entries:
            if entry.source_organization not in source_attempts:
                source_attempts.append(entry.source_organization)
            # The generator records the source license but does not yet attach an
            # explicit derivative CC BY-SA license. Fail closed until it does.
            decision = decide_rights(
                entry.rights_evidence,
                "generated_epub",
                request.territory,
                preserves_sharealike=False,
            )
            if decision.outcome != "generate" or (
                decision.requires_attribution and not entry.attribution
            ):
                continue
            rights_eligible = True
            try:
                return await self._generate(entry, request, source_attempts)
            except GenerationRejected:
                continue
            except ValidationFailed as error:
                validation_failed = error
                continue

        if validation_failed is not None:
            raise validation_failed
        if not rights_eligible:
            return EditionResolutionResult(
                status="unavailable",
                reason="The available source did not pass the demo's rights policy.",
                physical_edition=_physical_edition(request),
            )
        return EditionResolutionResult(
            status="unavailable",
            reason=(
                "We found an authorized structured source, but could not safely convert it "
                "into an EPUB."
            ),
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

    async def _generate(
        self,
        entry: ApprovedStructuredEntry,
        request: EditionResolveRequest,
        source_attempts: list[str],
    ) -> EditionResolutionResult:
        source_sha256 = hashlib.sha256(entry.content).hexdigest()
        if source_sha256 != entry.expected_source_sha256:
            raise ValidationFailed(
                "The reviewed structured source no longer matches its pinned hash"
            )
        generated_at = datetime.now(UTC).replace(microsecond=0)
        generated = generate_epub(
            StructuredSource(
                source_id=entry.entry_id,
                canonical_url=entry.source_url,
                title=entry.digital_title,
                authors=entry.authors,
                language=entry.language,
                content=entry.content,
                license_name=entry.license_name,
                license_url=entry.license_url,
                attribution=entry.attribution
                or f"{', '.join(entry.authors)}, {entry.license_name}.",
                content_format=entry.content_format,
            ),
            generated_at=generated_at.isoformat().replace("+00:00", "Z"),
        )
        try:
            inspect_epub(generated.content)
        except InvalidEpub as error:
            raise ValidationFailed(
                "Generated EPUB did not pass the archive safety check"
            ) from error
        try:
            validation = await self.validator.validate(generated.content)
        except RuntimeError as error:
            raise ValidationFailed("EPUB conformance validation could not run") from error
        if not validation.valid:
            raise ValidationFailed("EPUBCheck found conformance errors")
        try:
            delivery = await self.artifact_store.stage(
                content=generated.content,
                sha256=generated.final_sha256,
                title=entry.digital_title,
                authors=list(entry.authors),
            )
        except ValueError as error:
            raise ValidationFailed(
                "The generated EPUB could not be prepared for delivery"
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
                acquisition_url=entry.source_url,
                retrieved_at=entry.snapshot_retrieved_at,
                original_sha256=generated.source_sha256,
                final_sha256=generated.final_sha256,
                transformation="generated",
                epubcheck_version=validation.version,
                epubcheck_status="valid",
                epubcheck_warnings=validation.warnings,
                source_attempts=source_attempts,
                generated_at=generated_at,
                generator_version=generated.generator_version,
                transformation_steps=[
                    f"normalized authorized {entry.content_format.upper()}",
                    "packaged deterministic EPUB",
                ],
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


def _no_open_edition(request: EditionResolveRequest) -> EditionResolutionResult:
    return EditionResolutionResult(
        status="unavailable",
        reason="No reviewed open edition is available for this work yet.",
        physical_edition=_physical_edition(request),
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
