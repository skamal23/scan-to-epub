import re
from dataclasses import dataclass

from book_backend.rights.policy import RightsEvidence


@dataclass(frozen=True, slots=True)
class StandardEbookEntry:
    entry_id: str
    work_title: str
    aliases: tuple[str, ...]
    authors: tuple[str, ...]
    digital_title: str
    language: str
    digital_identifier: str
    canonical_url: str
    acquisition_url: str
    cover_url: str
    expected_sha256: str
    rights_evidence: RightsEvidence
    reviewed_at: str


@dataclass(frozen=True, slots=True)
class StandardEbooksCatalog:
    entries: tuple[StandardEbookEntry, ...]

    def find(
        self,
        title: str,
        authors: list[str],
        physical_isbn13: str | None,
    ) -> StandardEbookEntry | None:
        normalized_title = _normalized(title)
        normalized_authors = {_normalized(author) for author in authors}
        if not normalized_authors:
            return None
        for entry in self.entries:
            titles = {
                _normalized(entry.work_title),
                *(_normalized(alias) for alias in entry.aliases),
            }
            entry_authors = {_normalized(author) for author in entry.authors}
            if normalized_title in titles and normalized_authors & entry_authors:
                return entry
        return None


def _normalized(value: str) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", value.casefold())).replace(" & ", " and ")


_RIGHTS = "us_public_domain"
_REVIEWED = "2026-07-10"
_BASE = "https://standardebooks.org"

STANDARD_EBOOKS_CATALOG = StandardEbooksCatalog(
    entries=(
        StandardEbookEntry(
            entry_id="standardebooks:jane-austen_pride-and-prejudice",
            work_title="Pride and Prejudice",
            aliases=("Pride & Prejudice",),
            authors=("Jane Austen",),
            digital_title="Pride and Prejudice",
            language="en-GB",
            digital_identifier=f"{_BASE}/ebooks/jane-austen/pride-and-prejudice",
            canonical_url=f"{_BASE}/ebooks/jane-austen/pride-and-prejudice",
            acquisition_url=f"{_BASE}/ebooks/jane-austen/pride-and-prejudice/downloads/jane-austen_pride-and-prejudice.epub?source=download",
            cover_url=f"{_BASE}/images/covers/jane-austen_pride-and-prejudice/495dd49502f1fd5609a27a16f5af2f0a387accb4/cover@2x.jpg",
            expected_sha256="377c8b79622702c406de068d1ca4f6d2a8a675f46f801c2fe4013e1af17e6ee9",
            rights_evidence=_RIGHTS,
            reviewed_at=_REVIEWED,
        ),
        StandardEbookEntry(
            entry_id="standardebooks:herman-melville_moby-dick",
            work_title="Moby-Dick",
            aliases=("Moby Dick", "Moby Dick, or The Whale"),
            authors=("Herman Melville",),
            digital_title="Moby Dick, or The Whale",
            language="en-US",
            digital_identifier=f"{_BASE}/ebooks/herman-melville/moby-dick",
            canonical_url=f"{_BASE}/ebooks/herman-melville/moby-dick",
            acquisition_url=f"{_BASE}/ebooks/herman-melville/moby-dick/downloads/herman-melville_moby-dick.epub?source=download",
            cover_url=f"{_BASE}/images/covers/herman-melville_moby-dick/d30d8f15cb2f832ae68dbbc08e6b2a154aa6d109/cover@2x.jpg",
            expected_sha256="87e06598b17e5512ae04133ca4c794a1dc5a9f779b649559c0b92c15155abbdc",
            rights_evidence=_RIGHTS,
            reviewed_at=_REVIEWED,
        ),
        StandardEbookEntry(
            entry_id="standardebooks:mary-shelley_frankenstein",
            work_title="Frankenstein",
            aliases=("Frankenstein, or the Modern Prometheus",),
            authors=("Mary Shelley",),
            digital_title="Frankenstein, or the Modern Prometheus",
            language="en-GB",
            digital_identifier=f"{_BASE}/ebooks/mary-shelley/frankenstein",
            canonical_url=f"{_BASE}/ebooks/mary-shelley/frankenstein",
            acquisition_url=f"{_BASE}/ebooks/mary-shelley/frankenstein/downloads/mary-shelley_frankenstein.epub?source=download",
            cover_url=f"{_BASE}/images/covers/mary-shelley_frankenstein/a2a4d948cd6d7eaa6bd1ce223fe17e4380689b5a/cover@2x.jpg",
            expected_sha256="7be342e288497b37b0ec191d1ecdef99050c1b4828675ea5af450a0e62e43649",
            rights_evidence=_RIGHTS,
            reviewed_at=_REVIEWED,
        ),
        StandardEbookEntry(
            entry_id="standardebooks:bram-stoker_dracula",
            work_title="Dracula",
            aliases=(),
            authors=("Bram Stoker",),
            digital_title="Dracula",
            language="en-GB",
            digital_identifier=f"{_BASE}/ebooks/bram-stoker/dracula",
            canonical_url=f"{_BASE}/ebooks/bram-stoker/dracula",
            acquisition_url=f"{_BASE}/ebooks/bram-stoker/dracula/downloads/bram-stoker_dracula.epub?source=download",
            cover_url=f"{_BASE}/images/covers/bram-stoker_dracula/a02c17aca72aec342c861065c62cd25559a6d960/cover@2x.jpg",
            expected_sha256="8fb41790926f7da2aebe1c052cb13f874e87fa4c6ef5ebb487d82e83623ef95a",
            rights_evidence=_RIGHTS,
            reviewed_at=_REVIEWED,
        ),
        StandardEbookEntry(
            entry_id="standardebooks:charlotte-bronte_jane-eyre",
            work_title="Jane Eyre",
            aliases=("Jane Eyre: An Autobiography",),
            authors=("Charlotte Brontë", "Charlotte Bronte"),
            digital_title="Jane Eyre: An Autobiography",
            language="en-GB",
            digital_identifier=f"{_BASE}/ebooks/charlotte-bronte/jane-eyre",
            canonical_url=f"{_BASE}/ebooks/charlotte-bronte/jane-eyre",
            acquisition_url=f"{_BASE}/ebooks/charlotte-bronte/jane-eyre/downloads/charlotte-bronte_jane-eyre.epub?source=download",
            cover_url=f"{_BASE}/images/covers/charlotte-bronte_jane-eyre/315cd8030f893603f1cd1c5df3d11e000bfc3c8f/cover@2x.jpg",
            expected_sha256="a2f510add9cdeab848862c5e2ca675c1d7cd73f563409070673932323e458c5d",
            rights_evidence=_RIGHTS,
            reviewed_at=_REVIEWED,
        ),
    )
)
