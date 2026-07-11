from .approved_catalog import ApprovedEpubCatalog, ApprovedStructuredCatalog
from .doab import DOAB_CATALOG
from .oapen import OAPEN_CATALOG
from .standard_ebooks import STANDARD_EBOOKS_CATALOG

APPROVED_EPUB_CATALOG = ApprovedEpubCatalog(
    entries=STANDARD_EBOOKS_CATALOG.entries + OAPEN_CATALOG.entries + DOAB_CATALOG.entries
)

# Structured source snapshots are opt-in. No source reaches the generator until its
# exact content, rights evidence, and source hash have been reviewed into this catalog.
APPROVED_STRUCTURED_CATALOG = ApprovedStructuredCatalog(entries=())
