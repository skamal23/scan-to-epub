import re
import time
import unicodedata
from collections.abc import Callable
from difflib import SequenceMatcher


def normalized_words(value: str) -> tuple[str, ...]:
    decomposed = "".join(
        char for char in unicodedata.normalize("NFKD", value) if not unicodedata.combining(char)
    )
    normalized = decomposed.casefold().replace("&", " and ")
    return tuple(re.findall(r"[^\W_]+", normalized))


def title_match_score(query: str, candidate: str) -> float:
    query_words = normalized_words(query)
    candidate_words = normalized_words(candidate)
    if not query_words or not candidate_words:
        return 0.0
    if query_words == candidate_words:
        return 1.0

    derivative = r"\b(?:study guide|summary|summaries|workbook|retelling|abridged|adaptation)\b"
    if re.search(derivative, " ".join(candidate_words)) and not re.search(
        derivative, " ".join(query_words)
    ):
        return 0.4

    core_separator = r"\s*(?:[:,;]|--|—|\([^)]*\)\s*$)\s*"
    query_core = normalized_words(re.split(core_separator, query, maxsplit=1)[0])
    candidate_core = normalized_words(re.split(core_separator, candidate, maxsplit=1)[0])
    if query_core == candidate_core:
        return 0.95

    left = " ".join(query_words)
    right = " ".join(candidate_words)
    sequence_score = SequenceMatcher(None, left, right).ratio()
    query_set = set(query_words)
    candidate_set = set(candidate_words)
    token_score = len(query_set & candidate_set) / len(query_set | candidate_set)
    return 0.5 * sequence_score + 0.5 * token_score


def authors_match(query: list[str], candidates: tuple[str, ...]) -> bool:
    if not query:
        return True
    return any(_author_matches(left, right) for left in query for right in candidates)


def _author_matches(left: str, right: str) -> bool:
    left_words = normalized_words(left)
    right_words = normalized_words(right)
    if not left_words or not right_words:
        return False
    if (
        left_words == right_words
        or set(left_words).issubset(right_words)
        or set(right_words).issubset(left_words)
    ):
        return True

    left_family, left_given = _author_parts(left, left_words)
    right_family, right_given = _author_parts(right, right_words)
    if left_family != right_family:
        return False
    if not left_given or not right_given:
        return True
    return left_given[0][0] == right_given[0][0]


def _author_parts(value: str, words: tuple[str, ...]) -> tuple[str, tuple[str, ...]]:
    if "," in value:
        family_words = normalized_words(value.split(",", maxsplit=1)[0])
        family = family_words[-1] if family_words else words[0]
        given = words[len(family_words) :]
        return family, given
    return words[-1], words[:-1]


class TtlCache[K, V]:
    def __init__(
        self,
        *,
        ttl_seconds: float,
        copy: Callable[[V], V],
        clock: Callable[[], float] = time.monotonic,
    ):
        self.ttl_seconds = ttl_seconds
        self.copy = copy
        self.clock = clock
        self._values: dict[K, tuple[float, V]] = {}

    def get(self, key: K) -> V | None:
        cached = self._values.get(key)
        now = self.clock()
        if cached is None:
            return None
        if cached[0] <= now:
            self._values.pop(key, None)
            return None
        return self.copy(cached[1])

    def set(self, key: K, value: V) -> None:
        if self.ttl_seconds <= 0:
            return
        now = self.clock()
        self._values = {key: item for key, item in self._values.items() if item[0] > now}
        if len(self._values) >= 256:
            self._values.pop(next(iter(self._values)))
        self._values[key] = (now + self.ttl_seconds, self.copy(value))
