import pytest

from book_backend.config import Settings


def test_settings_read_test_fixture_mode() -> None:
    settings = Settings.from_env(
        {
            "BOOK_ENVIRONMENT": "test",
            "BOOK_FIXTURE_MODE": "true",
        }
    )

    assert settings.environment == "test"
    assert settings.fixture_mode is True


def test_settings_reject_unknown_environment() -> None:
    with pytest.raises(ValueError, match="Unsupported environment"):
        Settings.from_env({"BOOK_ENVIRONMENT": "production-ish"})
