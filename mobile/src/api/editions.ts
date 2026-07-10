import { ContractError, type MetadataCandidate } from './metadata';


export { ContractError } from './metadata';

export type EditionResolveRequest = {
  candidateId: string;
  workTitle: string;
  workAuthors: string[];
  physicalIsbn13: string | null;
  physicalPublisher: string | null;
  physicalPublishedDate: string | null;
  workSourceIds: Record<string, string>;
  editionSourceIds: Record<string, string>;
  territory: 'US';
};

export type PhysicalEditionInfo = {
  candidateId: string;
  title: string;
  authors: string[];
  isbn13: string | null;
  publisher: string | null;
  publishedDate: string | null;
  sourceIds: Record<string, string>;
};

export type DigitalEditionInfo = {
  title: string;
  authors: string[];
  language: string;
  identifier: string;
  publisher: string;
  coverUrl: string;
  isSamePublication: boolean;
};

export type EditionSourceInfo = { organization: string; canonicalUrl: string };
export type EditionRightsInfo = {
  licenseName: string;
  licenseUrl: string;
  rightsStatement: string;
  territory: string;
};
export type EditionProvenance = {
  catalogEntryId: string;
  catalogReviewedAt: string;
  acquisitionUrl: string;
  retrievedAt: string;
  originalSha256: string;
  finalSha256: string;
  transformation: 'unchanged';
  epubcheckVersion: string;
  epubcheckStatus: 'valid';
  epubcheckWarnings: string[];
};

export type EpubDeliveryInfo = {
  downloadPath: '/editions/download';
  downloadToken: string;
  filename: string;
  contentLength: number;
  sha256: string;
  expiresAt: string;
};

export type EditionResolutionResult = {
  status: 'ready' | 'unavailable';
  reason: string | null;
  physicalEdition: PhysicalEditionInfo | null;
  digitalEdition: DigitalEditionInfo | null;
  source: EditionSourceInfo | null;
  rights: EditionRightsInfo | null;
  provenance: EditionProvenance | null;
  delivery: EpubDeliveryInfo | null;
};

export type EditionClient = {
  resolve(request: EditionResolveRequest, signal?: AbortSignal): Promise<EditionResolutionResult>;
};

type FetchResponse = { ok: boolean; status: number; json?(): Promise<unknown> };
type Fetcher = (input: string, init: {
  method: 'POST';
  headers: { Accept: 'application/json'; 'Content-Type': 'application/json' };
  body: string;
  signal: AbortSignal;
}) => Promise<FetchResponse>;

export function requestForCandidate(candidate: MetadataCandidate): EditionResolveRequest {
  return {
    candidateId: candidate.candidateId,
    workTitle: candidate.work.title,
    workAuthors: candidate.work.authors,
    physicalIsbn13: candidate.edition.isbn13,
    physicalPublisher: candidate.edition.publisher,
    physicalPublishedDate: candidate.edition.publishedDate,
    workSourceIds: candidate.work.sourceIds,
    editionSourceIds: candidate.edition.sourceIds,
    territory: 'US',
  };
}

export function createEditionClient(options: {
  baseUrl: string;
  fetcher: Fetcher;
  timeoutMs: number;
}): EditionClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  return {
    async resolve(request, externalSignal) {
      const controller = new AbortController();
      let timedOut = false;
      const cancel = () => controller.abort();
      if (externalSignal?.aborted) controller.abort();
      else externalSignal?.addEventListener('abort', cancel, { once: true });
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, options.timeoutMs);
      try {
        let response: FetchResponse;
        try {
          response = await options.fetcher(`${baseUrl}/editions/resolve`, {
            method: 'POST',
            headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify(request),
            signal: controller.signal,
          });
        } catch (error) {
          if (controller.signal.aborted) {
            throw new Error(timedOut ? 'Open-edition check timed out' : 'Open-edition check cancelled');
          }
          throw new Error('Could not reach the open-edition service');
        }
        if (!response.ok) {
          if (response.status === 503) {
            throw new Error('Open-edition source is temporarily unavailable');
          }
          if (response.status === 502) {
            throw new Error('The open edition could not be verified');
          }
          throw new Error('Open-edition check failed');
        }
        if (!response.json) throw new ContractError('Edition response had no JSON body');
        return decodeEditionResolutionResult(await response.json());
      } finally {
        clearTimeout(timeout);
        externalSignal?.removeEventListener('abort', cancel);
      }
    },
  };
}

export function decodeEditionResolutionResult(value: unknown): EditionResolutionResult {
  if (!isRecord(value) || !isStatus(value.status) || !isNullableString(value.reason)) {
    throw new ContractError('Edition response did not match the contract');
  }
  const physicalEdition = value.physicalEdition === null ? null : decodePhysical(value.physicalEdition);
  if (value.status === 'unavailable') {
    if (value.digitalEdition !== null || value.source !== null || value.rights !== null || value.provenance !== null || value.delivery !== null) {
      throw new ContractError('Unavailable edition response contained delivery data');
    }
    return { status: value.status, reason: value.reason, physicalEdition, digitalEdition: null, source: null, rights: null, provenance: null, delivery: null };
  }
  return {
    status: 'ready',
    reason: value.reason,
    physicalEdition,
    digitalEdition: decodeDigital(value.digitalEdition),
    source: decodeSource(value.source),
    rights: decodeRights(value.rights),
    provenance: decodeProvenance(value.provenance),
    delivery: decodeDelivery(value.delivery),
  };
}

function decodePhysical(value: unknown): PhysicalEditionInfo {
  if (!isRecord(value) || typeof value.candidateId !== 'string' || typeof value.title !== 'string'
    || !isStringArray(value.authors) || !isNullableString(value.isbn13)
    || !isNullableString(value.publisher) || !isNullableString(value.publishedDate)
    || !isStringRecord(value.sourceIds)) throw new ContractError('Physical edition was invalid');
  return value as PhysicalEditionInfo;
}

function decodeDigital(value: unknown): DigitalEditionInfo {
  if (!isRecord(value) || typeof value.title !== 'string' || !isStringArray(value.authors)
    || typeof value.language !== 'string' || typeof value.identifier !== 'string'
    || typeof value.publisher !== 'string' || typeof value.coverUrl !== 'string'
    || typeof value.isSamePublication !== 'boolean') throw new ContractError('Digital edition was invalid');
  return value as DigitalEditionInfo;
}

function decodeSource(value: unknown): EditionSourceInfo {
  if (!isRecord(value) || typeof value.organization !== 'string' || typeof value.canonicalUrl !== 'string') throw new ContractError('Edition source was invalid');
  return value as EditionSourceInfo;
}

function decodeRights(value: unknown): EditionRightsInfo {
  if (!isRecord(value) || typeof value.licenseName !== 'string' || typeof value.licenseUrl !== 'string'
    || typeof value.rightsStatement !== 'string' || typeof value.territory !== 'string') throw new ContractError('Edition rights were invalid');
  return value as EditionRightsInfo;
}

function decodeProvenance(value: unknown): EditionProvenance {
  if (!isRecord(value) || typeof value.catalogEntryId !== 'string'
    || typeof value.catalogReviewedAt !== 'string' || typeof value.acquisitionUrl !== 'string'
    || typeof value.retrievedAt !== 'string' || !isSha(value.originalSha256)
    || !isSha(value.finalSha256) || value.transformation !== 'unchanged'
    || typeof value.epubcheckVersion !== 'string' || value.epubcheckStatus !== 'valid'
    || !isStringArray(value.epubcheckWarnings)) throw new ContractError('Edition provenance was invalid');
  return value as EditionProvenance;
}

function decodeDelivery(value: unknown): EpubDeliveryInfo {
  if (!isRecord(value) || value.downloadPath !== '/editions/download'
    || typeof value.downloadToken !== 'string' || value.downloadToken.length < 40
    || !isSafeEpubFilename(value.filename) || !isByteLength(value.contentLength)
    || !isSha(value.sha256) || !isIsoDate(value.expiresAt)) {
    throw new ContractError('EPUB delivery was invalid');
  }
  return value as EpubDeliveryInfo;
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null; }
function isNullableString(value: unknown): value is string | null { return value === null || typeof value === 'string'; }
function isStringArray(value: unknown): value is string[] { return Array.isArray(value) && value.every((item) => typeof item === 'string'); }
function isStringRecord(value: unknown): value is Record<string, string> { return isRecord(value) && Object.values(value).every((item) => typeof item === 'string'); }
function isSha(value: unknown): value is string { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }
function isSafeEpubFilename(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9-]{0,120}\.epub$/.test(value); }
function isByteLength(value: unknown): value is number { return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 25_000_000; }
function isIsoDate(value: unknown): value is string { return typeof value === 'string' && !Number.isNaN(Date.parse(value)); }
function isStatus(value: unknown): value is EditionResolutionResult['status'] { return value === 'ready' || value === 'unavailable'; }
