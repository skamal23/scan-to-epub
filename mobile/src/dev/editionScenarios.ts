import type { EditionResolutionResult } from '../api/editions';
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

export const editionScenarioCandidate = candidate;
