import re
from dataclasses import dataclass
from urllib.parse import urljoin, urlparse

from .approved_catalog import ApprovedEpubCatalog, ApprovedEpubEntry, EpubDownloadPolicy


@dataclass(frozen=True, slots=True)
class GutenbergMirrorEntry:
    ebook_id: int
    work_title: str
    aliases: tuple[str, ...]
    authors: tuple[str, ...]
    language: str
    relative_epub_path: str
    expected_sha256: str


class ProjectGutenbergMirrorCatalog:
    """A reviewed Project Gutenberg harvest exposed from an operator-controlled mirror.

    The public Project Gutenberg website is intentionally not used as an automated app
    download origin. Operators must provision each asset through Gutenberg's documented
    harvest or mirroring process and pin its resulting SHA-256 here.
    """

    def __init__(
        self,
        *,
        mirror_base_url: str,
        entries: tuple[GutenbergMirrorEntry, ...],
        reviewed_at: str,
    ):
        parsed = urlparse(mirror_base_url)
        if (
            parsed.scheme != "https"
            or not parsed.hostname
            or parsed.hostname.casefold() in {"gutenberg.org", "www.gutenberg.org"}
            or parsed.username
            or parsed.password
        ):
            raise ValueError("Project Gutenberg downloads require a configured HTTPS mirror")
        self.mirror_base_url = mirror_base_url.rstrip("/") + "/"
        self.mirror_host = parsed.hostname.casefold()
        self.reviewed_at = reviewed_at
        self.entries = entries
        self._catalog = ApprovedEpubCatalog(tuple(self._approved_entry(entry) for entry in entries))

    def find_all(
        self,
        title: str,
        authors: list[str],
        physical_isbn13: str | None,
    ) -> tuple[ApprovedEpubEntry, ...]:
        return self._catalog.find_all(title, authors, physical_isbn13)

    def _approved_entry(self, entry: GutenbergMirrorEntry) -> ApprovedEpubEntry:
        if (
            entry.relative_epub_path.startswith("/")
            or ".." in entry.relative_epub_path.split("/")
            or not re.fullmatch(r"[a-f0-9]{64}", entry.expected_sha256)
        ):
            raise ValueError("Project Gutenberg mirror manifest entry was invalid")
        acquisition_url = urljoin(self.mirror_base_url, entry.relative_epub_path)
        parsed_acquisition = urlparse(acquisition_url)
        if (
            parsed_acquisition.scheme != "https"
            or parsed_acquisition.hostname is None
            or parsed_acquisition.hostname.casefold() != self.mirror_host
            or parsed_acquisition.username
            or parsed_acquisition.password
        ):
            raise ValueError("Project Gutenberg mirror manifest escaped the reviewed mirror")
        return ApprovedEpubEntry(
            entry_id=f"project_gutenberg:{entry.ebook_id}",
            source_key="project_gutenberg",
            priority=30,
            work_title=entry.work_title,
            aliases=entry.aliases,
            authors=entry.authors,
            digital_title=entry.work_title,
            language=entry.language,
            digital_identifier=f"https://www.gutenberg.org/ebooks/{entry.ebook_id}",
            publisher="Project Gutenberg",
            source_organization="Project Gutenberg (reviewed mirror)",
            canonical_url=f"https://www.gutenberg.org/ebooks/{entry.ebook_id}",
            acquisition_url=acquisition_url,
            cover_url=None,
            rights_evidence="us_public_domain",
            license_name="Project Gutenberg License",
            license_url="https://www.gutenberg.org/policy/license.html",
            rights_statement=(
                "Project Gutenberg represents this unmodified ebook as not restricted in "
                "the United States. Its included Project Gutenberg license remains intact."
            ),
            attribution=(
                f"Project Gutenberg eBook #{entry.ebook_id}; distribute the unchanged EPUB "
                "with its included Project Gutenberg license."
            ),
            reviewed_at=self.reviewed_at,
            download_policy=EpubDownloadPolicy(
                allowed_hosts=frozenset({self.mirror_host}),
                expected_sha256=entry.expected_sha256,
            ),
        )
