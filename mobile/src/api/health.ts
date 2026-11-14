export type HealthResponse = {
  status: 'ok';
  service: 'book-backend';
  environment: string;
  fixtureMode: boolean;
  version: string;
};

export type BackendClient = {
  checkHealth(): Promise<HealthResponse>;
};

export class ContractError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function decodeHealthResponse(value: unknown): HealthResponse {
  if (
    !isRecord(value) ||
    value.status !== 'ok' ||
    value.service !== 'book-backend' ||
    typeof value.environment !== 'string' ||
    typeof value.fixtureMode !== 'boolean' ||
    typeof value.version !== 'string'
  ) {
    throw new ContractError('Backend health response did not match the contract');
  }

  return {
    status: value.status,
    service: value.service,
    environment: value.environment,
    fixtureMode: value.fixtureMode,
    version: value.version,
  };
}

type FetchResponse = {
  ok: boolean;
  status?: number;
  json?(): Promise<unknown>;
};

type Fetcher = (
  input: string,
  init: {
    method: 'GET';
    headers: { Accept: 'application/json' };
    signal: AbortSignal;
  },
) => Promise<FetchResponse>;

type BackendClientOptions = {
  baseUrl: string;
  fetcher: Fetcher;
  timeoutMs: number;
};

export function createBackendClient(options: BackendClientOptions): BackendClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const fetcher = options.fetcher;

  return {
    async checkHealth() {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
      try {
        let response: FetchResponse;
        try {
          response = await fetcher(`${baseUrl}/health`, {
            method: 'GET',
            headers: { Accept: 'application/json' },
            signal: controller.signal,
          });
        } catch (error) {
          if (controller.signal.aborted) {
            throw new Error('Connection timed out');
          }
          throw error;
        }
        if (!response.ok) {
          throw new Error(`Backend returned ${response.status ?? 'an error'}`);
        }
        if (!response.json) {
          throw new ContractError('Backend health response had no JSON body');
        }
        return decodeHealthResponse(await response.json());
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
