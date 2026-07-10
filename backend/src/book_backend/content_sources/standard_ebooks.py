from dataclasses import dataclass

from .approved_catalog import ApprovedEpubCatalog, ApprovedEpubEntry, EpubDownloadPolicy

StandardEbookEntry = ApprovedEpubEntry


@dataclass(frozen=True, slots=True)
class StandardEbooksCatalog:
    entries: tuple[StandardEbookEntry, ...]

    def find(
        self,
        title: str,
        authors: list[str],
        physical_isbn13: str | None,
    ) -> StandardEbookEntry | None:
        matches = self.find_all(title, authors, physical_isbn13)
        return matches[0] if matches else None

    def find_all(
        self,
        title: str,
        authors: list[str],
        physical_isbn13: str | None,
    ) -> tuple[StandardEbookEntry, ...]:
        return ApprovedEpubCatalog(self.entries).find_all(title, authors, physical_isbn13)


_REVIEWED = "2026-07-10"
_BASE = "https://standardebooks.org"
_RIGHTS_STATEMENT = (
    "Standard Ebooks represents the text and cover as public domain in the U.S. "
    "and dedicates its edition work to the public domain via CC0."
)


def _entry(
    *,
    entry_id: str,
    work_title: str,
    aliases: tuple[str, ...],
    authors: tuple[str, ...],
    digital_title: str,
    language: str,
    slug: str,
    cover_path: str,
    expected_sha256: str,
) -> StandardEbookEntry:
    author_slug, title_slug = slug.split("/", maxsplit=1)
    filename = f"{author_slug}_{title_slug}"
    canonical_url = f"{_BASE}/ebooks/{author_slug}/{title_slug}"
    return StandardEbookEntry(
        entry_id=entry_id,
        source_key="standard_ebooks",
        priority=10,
        work_title=work_title,
        aliases=aliases,
        authors=authors,
        digital_title=digital_title,
        language=language,
        digital_identifier=canonical_url,
        publisher="Standard Ebooks",
        source_organization="Standard Ebooks",
        canonical_url=canonical_url,
        acquisition_url=f"{canonical_url}/downloads/{filename}.epub?source=download",
        cover_url=f"{_BASE}/images/covers/{filename}/{cover_path}/cover@2x.jpg",
        rights_evidence="us_public_domain",
        license_name="CC0 1.0 Universal",
        license_url="https://creativecommons.org/publicdomain/zero/1.0/",
        rights_statement=_RIGHTS_STATEMENT,
        attribution=None,
        reviewed_at=_REVIEWED,
        download_policy=EpubDownloadPolicy(
            allowed_hosts=frozenset({"standardebooks.org"}),
            expected_sha256=expected_sha256,
        ),
    )


STANDARD_EBOOKS_CATALOG = StandardEbooksCatalog(
    entries=(
        _entry(
            entry_id="standardebooks:jane-austen_pride-and-prejudice",
            work_title="Pride and Prejudice",
            aliases=("Pride & Prejudice",),
            authors=("Jane Austen",),
            digital_title="Pride and Prejudice",
            language="en-GB",
            slug="jane-austen/pride-and-prejudice",
            cover_path="495dd49502f1fd5609a27a16f5af2f0a387accb4",
            expected_sha256="377c8b79622702c406de068d1ca4f6d2a8a675f46f801c2fe4013e1af17e6ee9",
        ),
        _entry(
            entry_id="standardebooks:herman-melville_moby-dick",
            work_title="Moby-Dick",
            aliases=("Moby Dick", "Moby Dick, or The Whale"),
            authors=("Herman Melville",),
            digital_title="Moby Dick, or The Whale",
            language="en-US",
            slug="herman-melville/moby-dick",
            cover_path="d30d8f15cb2f832ae68dbbc08e6b2a154aa6d109",
            expected_sha256="87e06598b17e5512ae04133ca4c794a1dc5a9f779b649559c0b92c15155abbdc",
        ),
        _entry(
            entry_id="standardebooks:mary-shelley_frankenstein",
            work_title="Frankenstein",
            aliases=("Frankenstein, or the Modern Prometheus",),
            authors=("Mary Shelley",),
            digital_title="Frankenstein, or the Modern Prometheus",
            language="en-GB",
            slug="mary-shelley/frankenstein",
            cover_path="a2a4d948cd6d7eaa6bd1ce223fe17e4380689b5a",
            expected_sha256="7be342e288497b37b0ec191d1ecdef99050c1b4828675ea5af450a0e62e43649",
        ),
        _entry(
            entry_id="standardebooks:bram-stoker_dracula",
            work_title="Dracula",
            aliases=(),
            authors=("Bram Stoker",),
            digital_title="Dracula",
            language="en-GB",
            slug="bram-stoker/dracula",
            cover_path="a02c17aca72aec342c861065c62cd25559a6d960",
            expected_sha256="8fb41790926f7da2aebe1c052cb13f874e87fa4c6ef5ebb487d82e83623ef95a",
        ),
        _entry(
            entry_id="standardebooks:charlotte-bronte_jane-eyre",
            work_title="Jane Eyre",
            aliases=("Jane Eyre: An Autobiography",),
            authors=("Charlotte Brontë", "Charlotte Bronte"),
            digital_title="Jane Eyre: An Autobiography",
            language="en-GB",
            slug="charlotte-bronte/jane-eyre",
            cover_path="315cd8030f893603f1cd1c5df3d11e000bfc3c8f",
            expected_sha256="a2f510add9cdeab848862c5e2ca675c1d7cd73f563409070673932323e458c5d",
        ),
    )
)
