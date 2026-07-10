import {
  ContractError,
  createBackendClient,
  decodeHealthResponse,
} from '../health';

describe('health API contract', () => {
  const healthPayload = {
    status: 'ok',
    service: 'book-backend',
    environment: 'test',
    fixtureMode: true,
    version: '0.1.0',
  } as const;

  test('decodes a valid backend health response', () => {
    expect(decodeHealthResponse(healthPayload)).toEqual(healthPayload);
  });

  test('rejects a response with missing contract fields', () => {
    expect(() => decodeHealthResponse({ status: 'ok' })).toThrow(ContractError);
  });

  test('requests the health endpoint and decodes its response', async () => {
    const fetcher = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => healthPayload,
    });
    const client = createBackendClient({
      baseUrl: 'http://127.0.0.1:8000/',
      fetcher,
      timeoutMs: 1000,
    });

    await expect(client.checkHealth()).resolves.toEqual(healthPayload);
    expect(fetcher).toHaveBeenCalledWith(
      'http://127.0.0.1:8000/health',
      expect.objectContaining({
        headers: { Accept: 'application/json' },
      }),
    );
  });

  test('reports an unavailable backend response', async () => {
    const client = createBackendClient({
      baseUrl: 'http://127.0.0.1:8000',
      fetcher: jest.fn().mockResolvedValue({ ok: false, status: 503 }),
      timeoutMs: 1000,
    });

    await expect(client.checkHealth()).rejects.toThrow('Backend returned 503');
  });

  test('aborts a slow request with a useful timeout error', async () => {
    jest.useFakeTimers();
    const fetcher = jest.fn(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise<never>((_resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        }),
    );
    const client = createBackendClient({
      baseUrl: 'http://127.0.0.1:8000',
      fetcher,
      timeoutMs: 50,
    });

    const healthCheck = client.checkHealth();
    jest.advanceTimersByTime(50);

    await expect(healthCheck).rejects.toThrow('Connection timed out');
    jest.useRealTimers();
  });
});
