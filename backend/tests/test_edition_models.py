from book_backend.editions.models import DigitalEditionInfo


def test_digital_edition_can_omit_a_cover_when_no_reusable_cover_is_authorized():
    edition = DigitalEditionInfo(
        title="Media Use in Digital Everyday Life",
        authors=["Brita Ytre-Arne"],
        language="en",
        identifier="https://library.oapen.org/handle/20.500.12657/61404",
        publisher="Emerald Publishing",
        cover_url=None,
        is_same_publication=False,
    )

    assert edition.cover_url is None
