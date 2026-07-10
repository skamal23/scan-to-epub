import pytest

from book_backend.metadata.isbn import InvalidISBN, normalize_isbn


@pytest.mark.parametrize(
    ("raw", "normalized"),
    [
        ("978-0-14-032872-1", "9780140328721"),
        ("9780306406157", "9780306406157"),
        ("0-306-40615-2", "0306406152"),
    ],
)
def test_normalize_isbn_accepts_valid_isbn10_and_isbn13(raw: str, normalized: str) -> None:
    assert normalize_isbn(raw) == normalized


@pytest.mark.parametrize("raw", ["", "9780306406158", "0306406153", "1234567890123"])
def test_normalize_isbn_rejects_invalid_values(raw: str) -> None:
    with pytest.raises(InvalidISBN):
        normalize_isbn(raw)
