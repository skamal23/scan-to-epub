from .approved_catalog import ApprovedEpubCatalog, ApprovedEpubEntry, EpubDownloadPolicy

OAPEN_CATALOG = ApprovedEpubCatalog(
    entries=(
        ApprovedEpubEntry(
            entry_id="oapen:20.500.12657/61404",
            source_key="oapen",
            priority=40,
            work_title="Media Use in Digital Everyday Life",
            aliases=(),
            authors=("Brita Ytre-Arne", "Ytre-Arne, Brita"),
            digital_title="Media Use in Digital Everyday Life",
            language="en",
            digital_identifier="https://library.oapen.org/handle/20.500.12657/61404",
            publisher="Emerald Publishing",
            source_organization="OAPEN",
            canonical_url="https://library.oapen.org/handle/20.500.12657/61404",
            acquisition_url=(
                "https://library.oapen.org/rest/bitstreams/"
                "2701eb6f-7f54-4914-8493-daed57eaadd8/retrieve"
            ),
            cover_url=None,
            rights_evidence="cc_by",
            license_name="CC BY 4.0",
            license_url="https://creativecommons.org/licenses/by/4.0/",
            rights_statement=(
                "OAPEN and the linked DOAB record identify this EPUB bitstream as CC BY 4.0."
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
