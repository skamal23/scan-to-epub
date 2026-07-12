from book_backend.content_sources.matching import TtlCache, authors_match, title_match_score


def test_title_matching_handles_punctuation_diacritics_and_subtitles():
    assert title_match_score("Moby Dick", "Moby-Dick; or, The Whale") >= 0.9
    assert title_match_score("Jane Eyre", "Jane Eyre: An Autobiography") >= 0.9
    assert title_match_score("The Man Who Was Thursday", "The Man Who Was Thursday") == 1.0
    assert title_match_score("À rebours", "A Rebours") == 1.0
    assert (
        title_match_score(
            "Narrative of the Life of Frederick Douglass",
            "Narrative of the Life of Frederick Douglass, an American Slave",
        )
        >= 0.9
    )
    assert title_match_score("Walden", "Walden, and On The Duty Of Civil Disobedience") >= 0.9


def test_title_matching_rejects_partial_title_collisions():
    assert title_match_score("Invisible Man", "The Invisible Man") < 0.8
    assert title_match_score("Emma", "Emma Goldman: A Documentary History") < 0.8


def test_author_matching_handles_initials_diacritics_and_family_first_order():
    assert authors_match(["H. G. Wells"], ("Wells, H. G. (Herbert George)",))
    assert authors_match(["Charlotte Brontë"], ("Bronte, Charlotte",))
    assert authors_match(["Mark Twain"], ("Twain, Mark",))
    assert not authors_match(["Ralph Ellison"], ("H. G. Wells",))


def test_ttl_cache_returns_copies_until_expiry():
    now = [10.0]
    cache: TtlCache[str, list[str]] = TtlCache(
        ttl_seconds=5,
        clock=lambda: now[0],
        copy=lambda value: list(value),
    )
    original = ["one"]
    cache.set("key", original)
    original.append("mutated")

    cached = cache.get("key")
    assert cached == ["one"]
    assert cached is not cache.get("key")

    now[0] = 15.0
    assert cache.get("key") is None
