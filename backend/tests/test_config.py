import pytest

from book_backend.config import Settings


def test_settings_read_test_fixture_mode() -> None:
    settings = Settings.from_env(
        {
            "BOOK_ENVIRONMENT": "test",
            "BOOK_FIXTURE_MODE": "true",
            "BOOK_COVER_MAX_BYTES": "2500000",
            "BOOK_COVER_TIMEOUT_SECONDS": "9.5",
        }
    )

    assert settings.environment == "test"
    assert settings.fixture_mode is True
    assert settings.cover_max_bytes == 2_500_000
    assert settings.cover_timeout_seconds == 9.5


def test_settings_reject_unknown_environment() -> None:
    with pytest.raises(ValueError, match="Unsupported environment"):
        Settings.from_env({"BOOK_ENVIRONMENT": "production-ish"})
