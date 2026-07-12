import io
import re
import stat
import zipfile
from dataclasses import dataclass
from pathlib import PurePosixPath

from defusedxml import ElementTree


class InvalidEpub(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class EpubInspection:
    entry_count: int
    expanded_bytes: int
    package_path: str


def inspect_epub(
    content: bytes,
    max_entries: int = 10_000,
    max_expanded_bytes: int = 100_000_000,
) -> EpubInspection:
    try:
        archive = zipfile.ZipFile(io.BytesIO(content))
    except zipfile.BadZipFile as error:
        raise InvalidEpub("EPUB is not a valid ZIP container") from error
    with archive:
        entries = archive.infolist()
        if not entries or len(entries) > max_entries:
            raise InvalidEpub("EPUB has an invalid number of entries")
        first = entries[0]
        if first.filename != "mimetype" or first.compress_type != zipfile.ZIP_STORED:
            raise InvalidEpub("EPUB mimetype must be the first uncompressed entry")
        if archive.read(first) != b"application/epub+zip":
            raise InvalidEpub("EPUB mimetype is invalid")

        expanded = 0
        for entry in entries:
            _check_entry(entry)
            expanded += entry.file_size
            if expanded > max_expanded_bytes:
                raise InvalidEpub("EPUB expands beyond the safety limit")
            if entry.compress_size and entry.file_size / entry.compress_size > 200:
                raise InvalidEpub("EPUB contains a suspicious compression ratio")
        if "META-INF/encryption.xml" in archive.namelist():
            _check_encryption(archive)
        try:
            container_xml = archive.read("META-INF/container.xml")
        except KeyError as error:
            raise InvalidEpub("EPUB container metadata is missing") from error
        try:
            root = ElementTree.fromstring(container_xml)
        except ElementTree.ParseError as error:
            raise InvalidEpub("EPUB container XML is invalid") from error
        package_path = next(
            (
                element.attrib.get("full-path")
                for element in root.iter()
                if element.tag.endswith("rootfile") and element.attrib.get("full-path")
            ),
            None,
        )
        if not package_path or package_path not in archive.namelist():
            raise InvalidEpub("EPUB package document is missing")
        _check_active_content(archive, entries)
        return EpubInspection(
            entry_count=len(entries),
            expanded_bytes=expanded,
            package_path=package_path,
        )


def _check_entry(entry: zipfile.ZipInfo) -> None:
    path = PurePosixPath(entry.filename)
    if "\\" in entry.filename or path.is_absolute() or ".." in path.parts:
        raise InvalidEpub("EPUB contains an unsafe path")
    mode = entry.external_attr >> 16
    if mode and stat.S_ISLNK(mode):
        raise InvalidEpub("EPUB contains a symbolic link")
    if entry.flag_bits & 0x1:
        raise InvalidEpub("EPUB contains an encrypted entry")


def _check_encryption(archive: zipfile.ZipFile) -> None:
    try:
        root = ElementTree.fromstring(archive.read("META-INF/encryption.xml"))
    except ElementTree.ParseError as error:
        raise InvalidEpub("EPUB is encrypted or DRM-protected") from error
    encrypted_data = [element for element in root.iter() if element.tag.endswith("EncryptedData")]
    if not encrypted_data:
        raise InvalidEpub("EPUB is encrypted or DRM-protected")
    names = set(archive.namelist())
    for encrypted in encrypted_data:
        methods = [
            element for element in encrypted.iter() if element.tag.endswith("EncryptionMethod")
        ]
        references = [
            element for element in encrypted.iter() if element.tag.endswith("CipherReference")
        ]
        if len(methods) != 1 or len(references) != 1:
            raise InvalidEpub("EPUB is encrypted or DRM-protected")
        if methods[0].attrib.get("Algorithm") != "http://www.idpf.org/2008/embedding":
            raise InvalidEpub("EPUB is encrypted or DRM-protected")
        uri = references[0].attrib.get("URI", "")
        path = PurePosixPath(uri)
        if (
            not uri
            or "\\" in uri
            or path.is_absolute()
            or ".." in path.parts
            or path.suffix.casefold() not in {".otf", ".ttf", ".woff", ".woff2"}
            or uri not in names
        ):
            raise InvalidEpub("EPUB is encrypted or DRM-protected")


def _check_active_content(archive: zipfile.ZipFile, entries: list[zipfile.ZipInfo]) -> None:
    script_pattern = re.compile(rb"<\s*script\b", re.IGNORECASE)
    remote_pattern = re.compile(
        rb"(?:src\s*=\s*['\"]https?://|url\(\s*['\"]?https?://|@import\s+['\"]https?://)",
        re.IGNORECASE,
    )
    for entry in entries:
        suffix = PurePosixPath(entry.filename).suffix.casefold()
        if suffix not in {".xhtml", ".html", ".htm", ".svg", ".css"}:
            continue
        if entry.file_size > 2_000_000:
            raise InvalidEpub("EPUB markup entry is too large to inspect safely")
        data = archive.read(entry)
        if script_pattern.search(data):
            raise InvalidEpub("EPUB contains script content")
        if remote_pattern.search(data):
            raise InvalidEpub("EPUB contains a remote resource")
