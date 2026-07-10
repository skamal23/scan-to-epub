import type { MetadataCandidate } from '../../api/metadata';
import { initialSearchState, searchReducer } from '../searchState';

const candidate = {
  candidateId: 'candidate-1',
  confidence: 'high',
  matchReasons: ['Exact ISBN match'],
  work: {
    title: 'Pride and Prejudice',
    authors: ['Jane Austen'],
    firstPublishedYear: 1813,
    language: 'en',
    sourceIds: {},
  },
  edition: {
    title: 'Pride and Prejudice',
    publisher: 'Penguin Classics',
    publishedDate: '2003',
    isbn10: '0141439513',
    isbn13: '9780141439518',
    coverUrl: null,
    sourceIds: {},
  },
  sources: [],
} satisfies MetadataCandidate;

describe('searchReducer', () => {
  test('moves through searching, candidates, and confirmation', () => {
    const searching = searchReducer(initialSearchState, { type: 'started' });
    const candidates = searchReducer(searching, {
      type: 'succeeded',
      candidates: [candidate],
      providerFailures: [],
    });
    const confirmed = searchReducer(candidates, { type: 'confirmed', candidate });

    expect(searching.status).toBe('searching');
    expect(candidates.status).toBe('candidates');
    expect(confirmed).toMatchObject({ status: 'confirmed', selected: candidate });
  });

  test('distinguishes no results from a request failure', () => {
    expect(
      searchReducer(initialSearchState, {
        type: 'succeeded',
        candidates: [],
        providerFailures: [],
      }).status,
    ).toBe('empty');
    expect(
      searchReducer(initialSearchState, { type: 'failed', message: 'Catalog unavailable' }),
    ).toMatchObject({ status: 'error', message: 'Catalog unavailable' });
  });
});
