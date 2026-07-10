from datetime import datetime

from book_backend.content_sources.standard_ebooks import STANDARD_EBOOKS_CATALOG

from .models import (
    DigitalEditionInfo,
    EditionProvenance,
    EditionResolutionResult,
    EditionResolveRequest,
    EditionRightsInfo,
    EditionSourceInfo,
    PhysicalEditionInfo,
)


class FixtureEditionResolutionService:
    async def resolve(self, request: EditionResolveRequest) -> EditionResolutionResult:
        entry = STANDARD_EBOOKS_CATALOG.find(
            request.work_title,
            request.work_authors,
            request.physical_isbn13,
        )
        physical = PhysicalEditionInfo(
            candidate_id=request.candidate_id,
            title=request.work_title,
            authors=request.work_authors,
            isbn13=request.physical_isbn13,
            publisher=request.physical_publisher,
            published_date=request.physical_published_date,
            source_ids=request.edition_source_ids,
        )
        if entry is None:
            return EditionResolutionResult(
                status="unavailable",
                reason="No reviewed open edition is available for this work yet.",
                physical_edition=physical,
            )
        return EditionResolutionResult(
            status="ready",
            physical_edition=physical,
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
                rights_statement="Reviewed U.S. public-domain and CC0 fixture.",
                territory="US",
            ),
            provenance=EditionProvenance(
                catalog_entry_id=entry.entry_id,
                catalog_reviewed_at=entry.reviewed_at,
                acquisition_url=entry.acquisition_url,
                retrieved_at=datetime.fromisoformat("2026-07-10T18:00:00+00:00"),
                original_sha256=entry.expected_sha256,
                final_sha256=entry.expected_sha256,
                transformation="unchanged",
                epubcheck_version="5.3.0",
                epubcheck_status="valid",
                epubcheck_warnings=[],
            ),
        )
