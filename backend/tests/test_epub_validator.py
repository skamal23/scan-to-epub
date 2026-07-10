from pathlib import Path

import pytest

from book_backend.epubs.validator import EpubcheckValidator


class Completed:
    def __init__(self, returncode=0, stdout="", stderr=""):
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr


@pytest.mark.anyio
async def test_epubcheck_uses_a_short_lived_file_and_records_version_and_warnings():
    observed_path = None

    def runner(command, **_options):
        nonlocal observed_path
        if command[1] == "--version":
            return Completed(stdout="EPUBCheck v5.3.0\n")
        observed_path = Path(command[1])
        assert observed_path.read_bytes() == b"epub-content"
        return Completed(stdout="WARNING(PKG-001): harmless fixture warning\n")

    result = await EpubcheckValidator(runner=runner).validate(b"epub-content")

    assert result.valid is True
    assert result.version == "5.3.0"
    assert result.warnings == ["WARNING(PKG-001): harmless fixture warning"]
    assert observed_path is not None
    assert observed_path.exists() is False


@pytest.mark.anyio
async def test_epubcheck_nonzero_exit_is_invalid_and_temp_file_is_deleted():
    observed_path = None

    def runner(command, **_options):
        nonlocal observed_path
        if command[1] == "--version":
            return Completed(stdout="EPUBCheck v5.3.0\n")
        observed_path = Path(command[1])
        return Completed(returncode=1, stderr="ERROR(PKG-001): invalid\n")

    result = await EpubcheckValidator(runner=runner).validate(b"broken")

    assert result.valid is False
    assert observed_path is not None
    assert observed_path.exists() is False


@pytest.mark.anyio
async def test_epubcheck_without_a_version_fails_closed_and_deletes_the_temp_file():
    observed_path = None

    def runner(command, **_options):
        nonlocal observed_path
        if command[1] == "--version":
            return Completed()
        observed_path = Path(command[1])
        return Completed()

    with pytest.raises(RuntimeError, match="did not report its version"):
        await EpubcheckValidator(runner=runner).validate(b"epub-content")

    assert observed_path is not None
    assert observed_path.exists() is False
