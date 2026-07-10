import io
import stat
import zipfile

import pytest

from book_backend.epubs.safety import InvalidEpub, inspect_epub


def epub_bytes(extra_entries=None, mimetype=b"application/epub+zip") -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr("mimetype", mimetype, compress_type=zipfile.ZIP_STORED)
        archive.writestr(
            "META-INF/container.xml",
            '<?xml version="1.0"?>'
            '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">'
            '<rootfiles><rootfile full-path="EPUB/content.opf" '
            'media-type="application/oebps-package+xml"/></rootfiles></container>',
        )
        archive.writestr("EPUB/content.opf", "<package/>")
        for name, value in extra_entries or []:
            archive.writestr(name, value)
    return output.getvalue()


def test_safe_epub_container_is_inspected_without_extraction():
    result = inspect_epub(epub_bytes([("EPUB/chapter.xhtml", "<html><body>Text</body></html>")]))

    assert result.entry_count == 4
    assert result.expanded_bytes > 0
    assert result.package_path == "EPUB/content.opf"


@pytest.mark.parametrize(
    ("payload", "message"),
    [
        (b"not a zip", "valid ZIP"),
        (epub_bytes(mimetype=b"text/plain"), "mimetype"),
        (epub_bytes([("../escape.xhtml", "bad")]), "unsafe path"),
        (epub_bytes([("EPUB/script.xhtml", "<script>alert(1)</script>")]), "script"),
        (
            epub_bytes([("EPUB/tracker.xhtml", '<img src="https://tracker.example/x">')]),
            "remote resource",
        ),
        (epub_bytes([("META-INF/encryption.xml", "<encryption/>")]), "encrypted"),
    ],
)
def test_unsafe_or_malformed_epubs_are_rejected(payload, message):
    with pytest.raises(InvalidEpub, match=message):
        inspect_epub(payload)


def test_symlink_entries_are_rejected():
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr("mimetype", b"application/epub+zip", compress_type=zipfile.ZIP_STORED)
        archive.writestr("META-INF/container.xml", "<container/>")
        link = zipfile.ZipInfo("EPUB/link")
        link.external_attr = (stat.S_IFLNK | 0o777) << 16
        archive.writestr(link, "target")

    with pytest.raises(InvalidEpub, match="symbolic link"):
        inspect_epub(output.getvalue())
