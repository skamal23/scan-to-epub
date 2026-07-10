import {
  ContractError,
  createEditionClient,
  decodeEditionResolutionResult,
  requestForCandidate,
} from '../editions';
import { metadataScenarios } from '../../dev/metadataScenarios';


const readyResult = {
  status: 'ready',
  reason: null,
  physicalEdition: {
    candidateId: 'fixture-pride',
    title: 'Pride and Prejudice',
    authors: ['Jane Austen'],
    isbn13: '9780141439518',
    publisher: 'Penguin Classics',
    publishedDate: '2003',
    sourceIds: { open_library: 'OL7353617M' },
  },
  digitalEdition: {
    title: 'Pride and Prejudice',
    authors: ['Jane Austen'],
    language: 'en-GB',
    identifier: 'https://standardebooks.org/ebooks/jane-austen/pride-and-prejudice',
    publisher: 'Standard Ebooks',
    coverUrl: 'https://standardebooks.org/cover.jpg',
    isSamePublication: false,
  },
  source: {
    organization: 'Standard Ebooks',
    canonicalUrl: 'https://standardebooks.org/ebooks/jane-austen/pride-and-prejudice',
  },
  rights: {
    licenseName: 'CC0 1.0 Universal',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    rightsStatement: 'Reviewed U.S. public-domain and CC0 edition.',
    territory: 'US',
  },
  provenance: {
    catalogEntryId: 'standardebooks:pride',
    catalogReviewedAt: '2026-07-10',
    acquisitionUrl: 'https://standardebooks.org/book.epub?source=download',
    retrievedAt: '2026-07-10T18:00:00Z',
    originalSha256: 'a'.repeat(64),
    finalSha256: 'a'.repeat(64),
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
    sha256: 'a'.repeat(64),
    expiresAt: '2026-07-10T18:10:00Z',
  },
};


test('builds a resolution request from the confirmed work and physical edition', () => {
  expect(requestForCandidate(metadataScenarios.one[0])).toEqual({
    candidateId: 'fixture-pride',
    workTitle: 'Pride and Prejudice',
    workAuthors: ['Jane Austen'],
    physicalIsbn13: '9780141439518',
    physicalPublisher: 'Penguin Classics',
    physicalPublishedDate: '2003',
    workSourceIds: { open_library: 'OL66554W' },
    editionSourceIds: { open_library: 'OL7353617M' },
    territory: 'US',
  });
});


test('decodes complete ready and unavailable contracts', () => {
  expect(decodeEditionResolutionResult(readyResult)).toEqual(readyResult);
  expect(decodeEditionResolutionResult({
    status: 'unavailable',
    reason: 'No reviewed open edition is available for this work yet.',
    physicalEdition: readyResult.physicalEdition,
    digitalEdition: null,
    source: null,
    rights: null,
    provenance: null,
    delivery: null,
  }).status).toBe('unavailable');
  expect(() => decodeEditionResolutionResult({ ...readyResult, provenance: null }))
    .toThrow(ContractError);
  expect(() => decodeEditionResolutionResult({ ...readyResult, delivery: null }))
    .toThrow(ContractError);
});


test('posts the confirmed edition and maps errors', async () => {
  const fetcher = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => readyResult,
  });
  const client = createEditionClient({ baseUrl: 'http://localhost:8000/', fetcher, timeoutMs: 5000 });

  await expect(client.resolve(requestForCandidate(metadataScenarios.one[0]))).resolves.toEqual(readyResult);
  expect(fetcher).toHaveBeenCalledWith(
    'http://localhost:8000/editions/resolve',
    expect.objectContaining({ method: 'POST', body: expect.any(String) }),
  );

  const unavailable = createEditionClient({
    baseUrl: 'http://localhost:8000',
    timeoutMs: 5000,
    fetcher: jest.fn().mockResolvedValue({ ok: false, status: 503 }),
  });
  await expect(unavailable.resolve(requestForCandidate(metadataScenarios.one[0])))
    .rejects.toThrow('Open-edition source is temporarily unavailable');
});
