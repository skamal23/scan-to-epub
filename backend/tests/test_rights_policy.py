import pytest

from book_backend.rights.policy import decide_rights


@pytest.mark.parametrize(
    ("evidence", "existing", "generated"),
    [
        ("us_public_domain", "deliver", "generate"),
        ("cc0", "deliver", "generate"),
        ("cc_by", "deliver", "generate"),
        ("cc_by_sa", "deliver", "generate"),
        ("cc_by_nc", "reject", "reject"),
        ("cc_by_nc_sa", "reject", "reject"),
        ("cc_by_nd", "reject", "reject"),
        ("cc_by_nc_nd", "reject", "reject"),
        ("free_to_read", "source_only", "source_only"),
        ("all_rights_reserved", "reject", "reject"),
        ("unknown", "reject", "reject"),
        ("borrowed", "reject", "reject"),
        ("sample", "reject", "reject"),
        ("drm", "reject", "reject"),
        ("source_authorized_distribution", "deliver", "reject"),
    ],
)
def test_rights_policy_is_explicit_and_fail_closed(evidence, existing, generated):
    assert decide_rights(evidence, "existing_epub", "US").outcome == existing
    assert decide_rights(evidence, "generated_epub", "US").outcome == generated


def test_rights_policy_rejects_wrong_territory_and_sharealike_without_compliance():
    assert decide_rights("us_public_domain", "existing_epub", "CA").outcome == "reject"
    assert (
        decide_rights("cc_by_sa", "generated_epub", "US", preserves_sharealike=False).outcome
        == "reject"
    )


def test_rights_policy_requires_attribution_for_by_licenses():
    assert decide_rights("cc_by", "existing_epub", "US").requires_attribution is True
    assert decide_rights("cc0", "existing_epub", "US").requires_attribution is False


def test_source_authorized_distribution_only_allows_the_unchanged_source_file():
    existing = decide_rights("source_authorized_distribution", "existing_epub", "US")
    generated = decide_rights("source_authorized_distribution", "generated_epub", "US")

    assert existing.outcome == "deliver"
    assert existing.requires_attribution is True
    assert generated.outcome == "reject"
