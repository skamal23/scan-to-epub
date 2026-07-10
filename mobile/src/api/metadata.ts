export type MetadataQuery =
  | { isbn: string }
  | { title: string; author?: string };

export type SourceEvidence = {
  provider: string;
  workId: string | null;
  editionId: string | null;
};

export type MetadataCandidate = {
  candidateId: string;
  confidence: 'high' | 'medium' | 'low';
  matchReasons: string[];
  work: {
    title: string;
    authors: string[];
    firstPublishedYear: number | null;
    language: string | null;
    sourceIds: Record<string, string>;
  };
  edition: {
    title: string;
    publisher: string | null;
    publishedDate: string | null;
    isbn10: string | null;
    isbn13: string | null;
    coverUrl: string | null;
    sourceIds: Record<string, string>;
  };
  sources: SourceEvidence[];
};

export type MetadataSearchResult = {
  candidates: MetadataCandidate[];
  providerFailures: string[];
};

export type MetadataClient = {
  search(query: MetadataQuery, signal?: AbortSignal): Promise<MetadataSearchResult>;
};

export class ContractError extends Error {}

type FetchResponse = {
  ok: boolean;
  status?: number;
  json?(): Promise<unknown>;
};

type Fetcher = (
  input: string,
  init: {
    method: 'POST';
    headers: { Accept: 'application/json'; 'Content-Type': 'application/json' };
    body: string;
    signal: AbortSignal;
  },
) => Promise<FetchResponse>;

export function createMetadataClient(options: {
  baseUrl: string;
  fetcher: Fetcher;
  timeoutMs: number;
}): MetadataClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  return {
    async search(query, externalSignal) {
      const controller = new AbortController();
      let timedOut = false;
      const cancel = () => controller.abort();
      if (externalSignal?.aborted) {
        controller.abort();
      } else {
        externalSignal?.addEventListener('abort', cancel, { once: true });
      }
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, options.timeoutMs);
      try {
        let response: FetchResponse;
        try {
          response = await options.fetcher(`${baseUrl}/metadata/search`, {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(query),
            signal: controller.signal,
          });
        } catch (error) {
          if (controller.signal.aborted) {
            throw new Error(timedOut ? 'Search timed out' : 'Search cancelled');
          }
          throw new Error('Could not reach the book catalogs');
        }
        if (!response.ok) {
          throw new Error(
            response.status === 422
              ? 'Check the ISBN or title and try again'
              : 'Book search is temporarily unavailable',
          );
        }
        if (!response.json) {
          throw new ContractError('Metadata response had no JSON body');
        }
        return decodeMetadataSearchResult(await response.json());
      } finally {
        clearTimeout(timeout);
        externalSignal?.removeEventListener('abort', cancel);
      }
    },
  };
}

export function decodeMetadataSearchResult(value: unknown): MetadataSearchResult {
  if (!isRecord(value) || !Array.isArray(value.candidates) || !isStringArray(value.providerFailures)) {
    throw new ContractError('Metadata response did not match the contract');
  }
  const candidates = value.candidates.map(decodeCandidate);
  return { candidates, providerFailures: value.providerFailures };
}

function decodeCandidate(value: unknown): MetadataCandidate {
  if (
    !isRecord(value) ||
    typeof value.candidateId !== 'string' ||
    !isConfidence(value.confidence) ||
    !isStringArray(value.matchReasons) ||
    !isRecord(value.work) ||
    typeof value.work.title !== 'string' ||
    !isStringArray(value.work.authors) ||
    !isNullableNumber(value.work.firstPublishedYear) ||
    !isNullableString(value.work.language) ||
    !isStringRecord(value.work.sourceIds) ||
    !isRecord(value.edition) ||
    typeof value.edition.title !== 'string' ||
    !isNullableString(value.edition.publisher) ||
    !isNullableString(value.edition.publishedDate) ||
    !isNullableString(value.edition.isbn10) ||
    !isNullableString(value.edition.isbn13) ||
    !isNullableString(value.edition.coverUrl) ||
    !isStringRecord(value.edition.sourceIds) ||
    !Array.isArray(value.sources)
  ) {
    throw new ContractError('Metadata candidate did not match the contract');
  }
  const sources = value.sources.map((source) => {
    if (
      !isRecord(source) ||
      typeof source.provider !== 'string' ||
      !isNullableString(source.workId) ||
      !isNullableString(source.editionId)
    ) {
      throw new ContractError('Metadata source did not match the contract');
    }
    return {
      provider: source.provider,
      workId: source.workId,
      editionId: source.editionId,
    };
  });
  return {
    candidateId: value.candidateId,
    confidence: value.confidence,
    matchReasons: value.matchReasons,
    work: {
      title: value.work.title,
      authors: value.work.authors,
      firstPublishedYear: value.work.firstPublishedYear,
      language: value.work.language,
      sourceIds: value.work.sourceIds,
    },
    edition: {
      title: value.edition.title,
      publisher: value.edition.publisher,
      publishedDate: value.edition.publishedDate,
      isbn10: value.edition.isbn10,
      isbn13: value.edition.isbn13,
      coverUrl: value.edition.coverUrl,
      sourceIds: value.edition.sourceIds,
    },
    sources,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === 'string');
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || typeof value === 'number';
}

function isConfidence(value: unknown): value is MetadataCandidate['confidence'] {
  return value === 'high' || value === 'medium' || value === 'low';
}
