from .approved_catalog import ApprovedEpubCatalog, ApprovedPdfCatalog, ApprovedStructuredCatalog
from .doab import DOAB_CATALOG
from .oapen import OAPEN_CATALOG
from .standard_ebooks import STANDARD_EBOOKS_CATALOG

APPROVED_EPUB_CATALOG = ApprovedEpubCatalog(
    entries=STANDARD_EBOOKS_CATALOG.entries + OAPEN_CATALOG.entries + DOAB_CATALOG.entries
)

# Structured source snapshots are opt-in. No source reaches the generator until its
# exact content, rights evidence, and source hash have been reviewed into this catalog.
APPROVED_STRUCTURED_CATALOG = ApprovedStructuredCatalog(entries=())

# PDF conversion is separately opt-in. An entry must contain a reviewed PDF snapshot,
# its source hash, and explicit transformation rights before it can reach the analyzer.
APPROVED_PDF_CATALOG = ApprovedPdfCatalog(entries=())
