import type { EditionResolutionResult } from '../api/editions';
import type { MetadataCandidate } from '../api/metadata';
import { metadataScenarios } from './metadataScenarios';

const candidate = metadataScenarios.one[0];

export const readyEditionScenario: EditionResolutionResult = {
  status: 'ready',
  reason: null,
  physicalEdition: {
    candidateId: candidate.candidateId,
    title: candidate.work.title,
    authors: candidate.work.authors,
    isbn13: candidate.edition.isbn13,
    publisher: candidate.edition.publisher,
    publishedDate: candidate.edition.publishedDate,
    sourceIds: candidate.edition.sourceIds,
  },
  digitalEdition: {
    title: 'Pride and Prejudice',
    authors: ['Jane Austen'],
    language: 'en-GB',
    identifier: 'https://standardebooks.org/ebooks/jane-austen/pride-and-prejudice',
    publisher: 'Standard Ebooks',
    coverUrl: 'https://standardebooks.org/images/covers/jane-austen_pride-and-prejudice/495dd49502f1fd5609a27a16f5af2f0a387accb4/cover@2x.jpg',
    isSamePublication: false,
  },
  source: {
    organization: 'Standard Ebooks',
    canonicalUrl: 'https://standardebooks.org/ebooks/jane-austen/pride-and-prejudice',
  },
  rights: {
    licenseName: 'CC0 1.0 Universal',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    rightsStatement: 'The text and cover are represented as U.S. public domain; Standard Ebooks dedicates its edition work via CC0.',
    attribution: null,
    territory: 'US',
  },
  provenance: {
    catalogEntryId: 'standardebooks:jane-austen_pride-and-prejudice',
    catalogReviewedAt: '2026-07-10',
    acquisitionUrl: 'https://standardebooks.org/ebooks/jane-austen/pride-and-prejudice/downloads/jane-austen_pride-and-prejudice.epub?source=download',
    retrievedAt: '2026-07-10T18:00:00Z',
    originalSha256: '377c8b79622702c406de068d1ca4f6d2a8a675f46f801c2fe4013e1af17e6ee9',
    finalSha256: '377c8b79622702c406de068d1ca4f6d2a8a675f46f801c2fe4013e1af17e6ee9',
    transformation: 'unchanged',
    epubcheckVersion: '5.3.0',
    epubcheckStatus: 'valid',
    epubcheckWarnings: [],
    sourceAttempts: ['Standard Ebooks'],
    generatedAt: null,
    generatorVersion: null,
    transformationSteps: [],
  },
  delivery: {
    downloadPath: '/editions/download',
    downloadToken: 'fixture-download-token-which-is-long-enough-to-be-opaque',
    filename: 'Pride-and-Prejudice-Jane-Austen.epub',
    contentLength: 1234,
    sha256: '377c8b79622702c406de068d1ca4f6d2a8a675f46f801c2fe4013e1af17e6ee9',
    expiresAt: '2026-07-10T18:10:00Z',
  },
};

export const unavailableEditionScenario: EditionResolutionResult = {
  status: 'unavailable',
  reason: 'No reviewed open edition is available for this work yet.',
  physicalEdition: readyEditionScenario.physicalEdition,
  digitalEdition: null,
  source: null,
  rights: null,
  provenance: null,
  delivery: null,
};

export const openLicenseFallbackScenario: EditionResolutionResult = {
  ...readyEditionScenario,
  digitalEdition: {
    ...readyEditionScenario.digitalEdition!,
    title: 'Open-license example (test scenario)',
    coverUrl: null,
  },
  source: {
    organization: 'Deterministic open-license scenario',
    canonicalUrl: 'https://example.invalid/open-license-scenario',
  },
  rights: {
    licenseName: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    rightsStatement: 'This development-only scenario exercises an open-license attribution state.',
    attribution: 'Example Author, CC BY 4.0.',
    territory: 'US',
  },
  provenance: {
    ...readyEditionScenario.provenance!,
    catalogEntryId: 'fixture:open-license-fallback',
    sourceAttempts: ['Standard Ebooks', 'Deterministic open-license scenario'],
  },
};

export const generatedEditionScenarioCandidate: MetadataCandidate = {
  candidateId: 'fixture:generated-html',
  confidence: 'high',
  matchReasons: ['Fixture-only generated EPUB scenario'],
  work: {
    title: 'Structured Open Text',
    authors: ['Example Author'],
    firstPublishedYear: 2026,
    language: 'en',
    sourceIds: { fixture: 'generated-html' },
  },
  edition: {
    title: 'Structured Open Text',
    publisher: 'Fixture Press',
    publishedDate: '2026',
    isbn10: null,
    isbn13: null,
    coverUrl: null,
    sourceIds: { fixture: 'generated-html-edition' },
  },
  sources: [],
};

export const generatedEditionScenario: EditionResolutionResult = {
  status: 'ready',
  reason: null,
  physicalEdition: {
    candidateId: generatedEditionScenarioCandidate.candidateId,
    title: generatedEditionScenarioCandidate.work.title,
    authors: generatedEditionScenarioCandidate.work.authors,
    isbn13: generatedEditionScenarioCandidate.edition.isbn13,
    publisher: generatedEditionScenarioCandidate.edition.publisher,
    publishedDate: generatedEditionScenarioCandidate.edition.publishedDate,
    sourceIds: generatedEditionScenarioCandidate.edition.sourceIds,
  },
  digitalEdition: {
    title: 'Structured Open Text (test export)',
    authors: ['Example Author'],
    language: 'en',
    identifier: 'urn:book-to-epub:fixture:generated-html',
    publisher: 'Book to EPUB test fixture',
    coverUrl: null,
    isSamePublication: false,
  },
  source: {
    organization: 'Deterministic generated fixture',
    canonicalUrl: 'https://example.invalid/test-only-generated-html',
  },
  rights: {
    licenseName: 'Test-only structured source',
    licenseUrl: 'https://example.invalid/test-only-generated-source',
    rightsStatement: 'This test-only EPUB is generated from purpose-built fixture text.',
    attribution: 'Book to EPUB test fixture.',
    territory: 'US',
  },
  provenance: {
    catalogEntryId: 'fixture:generated-html',
    catalogReviewedAt: '2026-07-10',
    acquisitionUrl: 'https://example.invalid/test-only-generated-html',
    retrievedAt: '2026-07-10T18:00:00Z',
    originalSha256: 'b'.repeat(64),
    finalSha256: 'c'.repeat(64),
    transformation: 'generated',
    epubcheckVersion: '5.3.0',
    epubcheckStatus: 'valid',
    epubcheckWarnings: [],
    sourceAttempts: ['Deterministic generated fixture'],
    generatedAt: '2026-07-10T18:05:00Z',
    generatorVersion: 'structured-epub/1',
    transformationSteps: ['normalized authorized HTML', 'packaged deterministic EPUB'],
  },
  delivery: {
    downloadPath: '/editions/download',
    downloadToken: 'fixture-generated-download-token-which-is-long-enough-to-be-opaque',
    filename: 'Structured-Open-Text-test-export-Example-Author.epub',
    contentLength: 1234,
    sha256: 'c'.repeat(64),
    expiresAt: '2026-07-10T18:10:00Z',
  },
};

export const generatedPlainTextEditionScenarioCandidate: MetadataCandidate = {
  ...generatedEditionScenarioCandidate,
  candidateId: 'fixture:generated-plain-text',
  work: {
    ...generatedEditionScenarioCandidate.work,
    title: 'Structured Plain Text',
    sourceIds: { fixture: 'generated-plain-text' },
  },
  edition: {
    ...generatedEditionScenarioCandidate.edition,
    title: 'Structured Plain Text',
    sourceIds: { fixture: 'generated-plain-text-edition' },
  },
};

export const generatedPlainTextEditionScenario: EditionResolutionResult = {
  ...generatedEditionScenario,
  physicalEdition: {
    ...generatedEditionScenario.physicalEdition!,
    candidateId: generatedPlainTextEditionScenarioCandidate.candidateId,
    title: generatedPlainTextEditionScenarioCandidate.work.title,
    authors: generatedPlainTextEditionScenarioCandidate.work.authors,
    publisher: generatedPlainTextEditionScenarioCandidate.edition.publisher,
    publishedDate: generatedPlainTextEditionScenarioCandidate.edition.publishedDate,
    sourceIds: generatedPlainTextEditionScenarioCandidate.edition.sourceIds,
  },
  digitalEdition: {
    ...generatedEditionScenario.digitalEdition!,
    title: 'Structured Plain Text (test export)',
    identifier: 'urn:book-to-epub:fixture:generated-plain-text',
  },
  source: {
    organization: 'Deterministic generated fixture',
    canonicalUrl: 'https://example.invalid/test-only-generated-plain-text',
  },
  provenance: {
    ...generatedEditionScenario.provenance!,
    catalogEntryId: 'fixture:generated-plain-text',
    acquisitionUrl: 'https://example.invalid/test-only-generated-plain-text',
    originalSha256: 'd'.repeat(64),
    finalSha256: 'e'.repeat(64),
    transformationSteps: ['normalized authorized PLAIN_TEXT', 'packaged deterministic EPUB'],
  },
  delivery: {
    ...generatedEditionScenario.delivery!,
    filename: 'Structured-Plain-Text-test-export-Example-Author.epub',
    sha256: 'e'.repeat(64),
  },
};

export const generatedPdfEditionScenarioCandidate: MetadataCandidate = {
  ...generatedEditionScenarioCandidate,
  candidateId: 'fixture:generated-pdf',
  work: {
    ...generatedEditionScenarioCandidate.work,
    title: 'Authorized PDF Source',
    sourceIds: { fixture: 'generated-pdf' },
  },
  edition: {
    ...generatedEditionScenarioCandidate.edition,
    title: 'Authorized PDF Source',
    sourceIds: { fixture: 'generated-pdf-edition' },
  },
};

export const pdfConversionRefusalScenarioCandidate: MetadataCandidate = {
  ...generatedPdfEditionScenarioCandidate,
  candidateId: 'fixture:pdf-refused',
  work: {
    ...generatedPdfEditionScenarioCandidate.work,
    title: 'PDF Conversion Refusal',
    sourceIds: { fixture: 'pdf-refused' },
  },
  edition: {
    ...generatedPdfEditionScenarioCandidate.edition,
    title: 'PDF Conversion Refusal',
    sourceIds: { fixture: 'pdf-refused-edition' },
  },
};

export const generatedPdfEditionScenario: EditionResolutionResult = {
  ...generatedEditionScenario,
  physicalEdition: {
    ...generatedEditionScenario.physicalEdition!,
    candidateId: generatedPdfEditionScenarioCandidate.candidateId,
    title: generatedPdfEditionScenarioCandidate.work.title,
    authors: generatedPdfEditionScenarioCandidate.work.authors,
    publisher: generatedPdfEditionScenarioCandidate.edition.publisher,
    publishedDate: generatedPdfEditionScenarioCandidate.edition.publishedDate,
    sourceIds: generatedPdfEditionScenarioCandidate.edition.sourceIds,
  },
  digitalEdition: {
    ...generatedEditionScenario.digitalEdition!,
    title: 'Authorized PDF Source (test export)',
    identifier: 'urn:book-to-epub:fixture:generated-pdf',
  },
  source: {
    organization: 'Deterministic PDF fixture',
    canonicalUrl: 'https://example.invalid/test-only-generated-pdf',
  },
  rights: {
    licenseName: 'Test-only PDF source',
    licenseUrl: 'https://example.invalid/test-only-generated-pdf',
    rightsStatement: 'This test-only EPUB is generated from a purpose-built PDF fixture.',
    attribution: 'Book to EPUB PDF test fixture.',
    territory: 'US',
  },
  provenance: {
    ...generatedEditionScenario.provenance!,
    catalogEntryId: 'fixture:generated-pdf',
    acquisitionUrl: 'https://example.invalid/test-only-generated-pdf',
    retrievedAt: '2026-07-10T17:00:00Z',
    originalSha256: 'f'.repeat(64),
    finalSha256: 'e'.repeat(64),
    generatorVersion: 'guarded-pdf/3 + structured-epub/1',
    transformationSteps: [
      'analyzed authorized PDF with guarded-pdf/3',
      'accounted for 3 PDF body blocks',
      'removed 4 classified PDF artifacts',
      'removed running_header (p1-l1)',
      'removed page_number (p1-l4)',
      'removed running_header (p2-l1)',
      'removed page_number (p2-l3)',
      'normalized authorized PDF into HTML',
      'packaged deterministic EPUB',
    ],
  },
  delivery: {
    ...generatedEditionScenario.delivery!,
    filename: 'Authorized-PDF-Source-test-export-Example-Author.epub',
    sha256: 'e'.repeat(64),
  },
};

export const pdfConversionRefusalScenario: EditionResolutionResult = {
  status: 'unavailable',
  reason: 'We found an authorized PDF, but could not safely convert its layout into an EPUB.',
  physicalEdition: {
    ...generatedPdfEditionScenario.physicalEdition!,
    candidateId: pdfConversionRefusalScenarioCandidate.candidateId,
    title: pdfConversionRefusalScenarioCandidate.work.title,
    authors: pdfConversionRefusalScenarioCandidate.work.authors,
    publisher: pdfConversionRefusalScenarioCandidate.edition.publisher,
    publishedDate: pdfConversionRefusalScenarioCandidate.edition.publishedDate,
    sourceIds: pdfConversionRefusalScenarioCandidate.edition.sourceIds,
  },
  digitalEdition: null,
  source: null,
  rights: null,
  provenance: null,
  delivery: null,
};

export const editionScenarioCandidate = candidate;
