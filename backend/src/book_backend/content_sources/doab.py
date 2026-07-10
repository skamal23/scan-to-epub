from collections.abc import Mapping
from typing import Any

from book_backend.rights.policy import RightsEvidence

from .approved_catalog import ApprovedEpubCatalog, ApprovedEpubEntry, EpubDownloadPolicy

_ACCEPTABLE_FINAL_FILE_CODES: dict[str, RightsEvidence] = {
    "CC0": "cc0",
    "CC-BY": "cc_by",
    "CC-BY-SA": "cc_by_sa",
}


def doab_final_epub_rights(record: Mapping[str, Any]) -> RightsEvidence | None:
    """Return rights only when the final EPUB bitstream itself has accepted evidence.

    DOAB record-level metadata is useful for discovery but does not establish the license of
    an arbitrary file target. In particular, an apparently permissive record must not turn an
    NC/ND EPUB into a deliverable asset.
    """

    bitstreams = record.get("bitstreams")
    if not isinstance(bitstreams, list):
        return None
    for bitstream in bitstreams:
        if not isinstance(bitstream, Mapping):
            continue
        if bitstream.get("mimeType") != "application/epub+zip":
            continue
        code = bitstream.get("code")
        if isinstance(code, str):
            return _ACCEPTABLE_FINAL_FILE_CODES.get(code)
    return None


DOAB_CATALOG = ApprovedEpubCatalog(
    entries=(
        ApprovedEpubEntry(
            entry_id="doab:20.500.12854/97704",
            source_key="doab",
            priority=50,
            work_title="Media Use in Digital Everyday Life",
            aliases=(),
            authors=("Brita Ytre-Arne", "Ytre-Arne, Brita"),
            digital_title="Media Use in Digital Everyday Life",
            language="en",
            digital_identifier="https://library.oapen.org/handle/20.500.12657/61404",
            publisher="Emerald Publishing",
            source_organization="DOAB record / OAPEN file",
            canonical_url="https://directory.doabooks.org/handle/20.500.12854/97704",
            acquisition_url=(
                "https://library.oapen.org/rest/bitstreams/"
                "2701eb6f-7f54-4914-8493-daed57eaadd8/retrieve"
            ),
            cover_url=None,
            rights_evidence="cc_by",
            license_name="CC BY 4.0",
            license_url="https://creativecommons.org/licenses/by/4.0/",
            rights_statement=(
                "DOAB is a discovery directory. Its reviewed record points to the OAPEN "
                "EPUB and records CC BY 4.0 rights evidence for this open edition."
            ),
            attribution=(
                "Brita Ytre-Arne, Media Use in Digital Everyday Life (Emerald Publishing, 2023), "
                "CC BY 4.0."
            ),
            reviewed_at="2026-07-10",
            download_policy=EpubDownloadPolicy(
                allowed_hosts=frozenset({"library.oapen.org"}),
                expected_sha256=(
                    "cae6797fdf63b0a91cd7b6a7a8c5ce0a08405d4778390303c48cf0221859b666"
                ),
                expected_md5="981844836d05d7a11c82bd3fe2483b7b",
            ),
        ),
    )
)
