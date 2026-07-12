# Expanded Open-Source EPUB Discovery

## Goal

Expand live, dynamic discovery beyond Standard Ebooks and Project Gutenberg while preserving a strict legal and operational rule: query sources sequentially and stop as soon as one source produces a rights-eligible EPUB that downloads and passes EPUB validation.

## Source order

1. Standard Ebooks: curated public-domain EPUBs and consistently high file quality.
2. Project Gutenberg: much larger public-domain catalog; accept only records whose feed explicitly identifies the work as public domain in the United States.
3. English Wikisource: community-proofread public-domain/CC BY-SA works, exported as EPUB by the official WS Export service.
4. Unglue.it: open-access OPDS records; accept only Public Domain, CC0, CC BY, or CC BY-SA EPUB acquisitions and exclude Gutenberg/DOAB duplicates.
5. OAPEN: scholarly open-access books; accept only existing EPUB bitstreams carrying CC0, CC BY, or CC BY-SA metadata.
6. Google Books, when configured: existing strict full-public-domain EPUB integration.

The static reviewed catalog remains an offline fallback after live sources. Structured-text and reviewed-PDF generation remain last-resort fallbacks.

## Matching and safety

- Search by confirmed work title, then require strong title similarity and an author match.
- Never treat physical ownership as rights evidence.
- Never accept NC, ND, free-to-read, borrowed, preview, DRM, unknown, or all-rights-reserved records.
- Preserve the source file unchanged and carry source, license, attribution, retrieval, and checksum provenance.
- Restrict every download to source-specific HTTPS hosts and validate the downloaded container plus EPUBCheck before delivery.
- Cache search results briefly, but do not prefetch later sources.

## Success behavior

For each source, try matching editions in source-defined preference order. If discovery returns no match, the source is unavailable, download fails, or EPUB validation fails, continue to the next source. Return immediately after the first verified EPUB. No later source may be queried after success.

## Scope boundary

This expansion dynamically covers eligible EPUBs exposed by the supported source APIs. It does not imply every item in OAPEN or Wikisource has an EPUB, and it does not dynamically convert arbitrary PDFs because layout conversion and derivative licensing require additional safeguards.
