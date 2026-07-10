class InvalidISBN(ValueError):
    pass


def normalize_isbn(value: str) -> str:
    normalized = "".join(
        character for character in value.upper() if character.isdigit() or character == "X"
    )
    if len(normalized) == 13 and _valid_isbn13(normalized):
        return normalized
    if len(normalized) == 10 and _valid_isbn10(normalized):
        return normalized
    raise InvalidISBN("Enter a valid ISBN-10 or ISBN-13")


def _valid_isbn13(value: str) -> bool:
    if not value.isdigit() or not value.startswith(("978", "979")):
        return False
    total = sum(
        int(character) * (1 if index % 2 == 0 else 3) for index, character in enumerate(value[:12])
    )
    return (10 - total % 10) % 10 == int(value[-1])


def _valid_isbn10(value: str) -> bool:
    if not value[:9].isdigit() or not (value[-1].isdigit() or value[-1] == "X"):
        return False
    digits = [int(character) for character in value[:9]]
    digits.append(10 if value[-1] == "X" else int(value[-1]))
    return sum((10 - index) * digit for index, digit in enumerate(digits)) % 11 == 0
