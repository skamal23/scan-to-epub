import asyncio
import os
import re
import subprocess
import tempfile
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True, slots=True)
class EpubcheckResult:
    version: str
    valid: bool
    warnings: list[str]


class EpubcheckValidator:
    def __init__(
        self,
        runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
        timeout_seconds: float = 30,
    ):
        self.runner = runner
        self.timeout_seconds = timeout_seconds

    async def validate(self, content: bytes) -> EpubcheckResult:
        return await asyncio.to_thread(self._validate, content)

    def _validate(self, content: bytes) -> EpubcheckResult:
        descriptor, filename = tempfile.mkstemp(suffix=".epub", prefix="book-validation-")
        try:
            with os.fdopen(descriptor, "wb") as output:
                output.write(content)
            version = self.runner(
                ["epubcheck", "--version"],
                capture_output=True,
                text=True,
                timeout=5,
                check=False,
            )
            result = self.runner(
                ["epubcheck", filename],
                capture_output=True,
                text=True,
                timeout=self.timeout_seconds,
                check=False,
            )
            warnings = [
                line.strip()
                for line in (result.stdout + "\n" + result.stderr).splitlines()
                if re.match(r"\s*(?:WARNING\b|\[WARNING\])", line, re.IGNORECASE)
            ]
            version_lines = (version.stdout or version.stderr).strip().splitlines()
            if not version_lines:
                raise RuntimeError("EPUBCheck did not report its version")
            version_text = version_lines[0]
            return EpubcheckResult(
                version=version_text.removeprefix("EPUBCheck v").strip(),
                valid=result.returncode == 0,
                warnings=warnings,
            )
        except (FileNotFoundError, subprocess.TimeoutExpired) as error:
            raise RuntimeError("EPUBCheck is unavailable") from error
        finally:
            Path(filename).unlink(missing_ok=True)
