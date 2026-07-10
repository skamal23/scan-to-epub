from .approved_catalog import ApprovedEpubCatalog
from .doab import DOAB_CATALOG
from .oapen import OAPEN_CATALOG
from .standard_ebooks import STANDARD_EBOOKS_CATALOG

APPROVED_EPUB_CATALOG = ApprovedEpubCatalog(
    entries=STANDARD_EBOOKS_CATALOG.entries + OAPEN_CATALOG.entries + DOAB_CATALOG.entries
)
