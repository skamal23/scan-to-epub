import {
  ContractError,
  createMetadataClient,
  decodeMetadataSearchResult,
  type MetadataSearchResult,
} from '../metadata';

const result: MetadataSearchResult = {
  candidates: [
    {
      candidateId: 'candidate-1',
      confidence: 'high',
      matchReasons: ['Exact ISBN match'],
      work: {
        title: 'Pride and Prejudice',
        authors: ['Jane Austen'],
        firstPublishedYear: 1813,
        language: 'en',
        sourceIds: { open_library: 'OL66554W' },
      },
      edition: {
        title: 'Pride and Prejudice',
        publisher: 'Penguin Classics',
        publishedDate: '2003',
        isbn10: '0141439513',
        isbn13: '9780141439518',
        coverUrl: null,
        sourceIds: { open_library: 'OL7353617M' },
      },
      sources: [
        { provider: 'open_library', workId: 'OL66554W', editionId: 'OL7353617M' },
      ],
    },
  ],
  providerFailures: [],
};

describe('metadata API contract', () => {
  test('decodes separate work and edition metadata', () => {
    expect(decodeMetadataSearchResult(result)).toEqual(result);
  });

  test('rejects malformed candidates', () => {
    expect(() => decodeMetadataSearchResult({ candidates: [{ title: 'No structure' }] })).toThrow(
      ContractError,
    );
  });

  test('posts a normalized search request', async () => {
    const fetcher = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => result,
    });
    const client = createMetadataClient({
      baseUrl: 'http://127.0.0.1:8000/',
      fetcher,
      timeoutMs: 1000,
    });

    await expect(client.search({ isbn: '9780141439518' })).resolves.toEqual(result);
    expect(fetcher).toHaveBeenCalledWith(
      'http://127.0.0.1:8000/metadata/search',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ isbn: '9780141439518' }),
      }),
    );
  });

  test('aborts when the caller cancels the search', async () => {
    const fetcher = jest.fn(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise<never>((_resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        }),
    );
    const client = createMetadataClient({
      baseUrl: 'http://127.0.0.1:8000',
      fetcher,
      timeoutMs: 1000,
    });
    const controller = new AbortController();

    const search = client.search({ isbn: '9780141439518' }, controller.signal);
    controller.abort();

    await expect(search).rejects.toThrow('Search cancelled');
  });
});
