import os
from collections.abc import Mapping
from dataclasses import dataclass

ALLOWED_ENVIRONMENTS = frozenset({"development", "fixture", "test", "production"})


@dataclass(frozen=True, slots=True)
class Settings:
    environment: str = "development"
    fixture_mode: bool = False

    @classmethod
    def from_env(cls, values: Mapping[str, str] | None = None) -> "Settings":
        source = os.environ if values is None else values
        environment = source.get("BOOK_ENVIRONMENT", "development").strip().lower()
        if environment not in ALLOWED_ENVIRONMENTS:
            raise ValueError(f"Unsupported environment: {environment}")

        fixture_value = source.get("BOOK_FIXTURE_MODE", "false").strip().lower()
        fixture_mode = fixture_value in {"1", "true", "yes", "on"}
        return cls(environment=environment, fixture_mode=fixture_mode)
