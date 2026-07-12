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


def test_standard_idpf_font_obfuscation_is_not_misclassified_as_drm():
    encryption = """
    <encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"
      xmlns:enc="http://www.w3.org/2001/04/xmlenc#">
      <enc:EncryptedData>
        <enc:EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding" />
        <enc:CipherData><enc:CipherReference URI="EPUB/fonts/body.ttf" /></enc:CipherData>
      </enc:EncryptedData>
    </encryption>
    """

    result = inspect_epub(
        epub_bytes(
            [
                ("META-INF/encryption.xml", encryption),
                ("EPUB/fonts/body.ttf", b"obfuscated-font-data"),
            ]
        )
    )

    assert result.entry_count == 5


@pytest.mark.parametrize(
    ("algorithm", "uri"),
    [
        ("http://www.w3.org/2001/04/xmlenc#aes256-cbc", "EPUB/fonts/body.ttf"),
        ("http://www.idpf.org/2008/embedding", "EPUB/chapter.xhtml"),
    ],
)
def test_encryption_xml_still_rejects_drm_or_non_font_targets(algorithm, uri):
    encryption = f'''
    <encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"
      xmlns:enc="http://www.w3.org/2001/04/xmlenc#">
      <enc:EncryptedData>
        <enc:EncryptionMethod Algorithm="{algorithm}" />
        <enc:CipherData><enc:CipherReference URI="{uri}" /></enc:CipherData>
      </enc:EncryptedData>
    </encryption>
    '''

    with pytest.raises(InvalidEpub, match="encrypted"):
        inspect_epub(epub_bytes([("META-INF/encryption.xml", encryption), (uri, b"data")]))


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
