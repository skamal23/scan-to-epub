import {
  ContractError,
  decodeMetadataCandidate,
  type MetadataCandidate,
} from './metadata';


export { ContractError } from './metadata';

export type CoverRecognitionResult = {
  status: 'matched' | 'ambiguous' | 'no_match';
  confidence: 'high' | 'medium' | 'low';
  extractedTitle: string | null;
  extractedAuthor: string | null;
  candidates: MetadataCandidate[];
  providerFailures: string[];
};

export type UploadProgress = {
  totalBytesSent: number;
  totalBytesExpectedToSend: number;
};

type UploadResult = { status: number; body: string } | undefined;

type UploadTask = {
  uploadAsync(): Promise<UploadResult>;
  cancelAsync(): Promise<void>;
};

export type CreateUploadTask = (
  url: string,
  fileUri: string,
  options: {
    headers: { Accept: 'application/json' };
    httpMethod: 'POST';
    mimeType: 'image/jpeg';
    uploadType: 0;
  },
  callback?: (progress: UploadProgress) => void,
) => UploadTask;

export type CoverClient = {
  recognize(
    fileUri: string,
    signal?: AbortSignal,
    onProgress?: (progress: number) => void,
  ): Promise<CoverRecognitionResult>;
};

export function createCoverClient(options: {
  baseUrl: string;
  createUploadTask: CreateUploadTask;
  timeoutMs: number;
}): CoverClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  return {
    async recognize(fileUri, externalSignal, onProgress) {
      const task = options.createUploadTask(
        `${baseUrl}/covers/recognize`,
        fileUri,
        {
          headers: { Accept: 'application/json' },
          httpMethod: 'POST',
          mimeType: 'image/jpeg',
          uploadType: 0,
        },
        onProgress
          ? (progress) => {
              const expected = progress.totalBytesExpectedToSend;
              const ratio = expected > 0 ? progress.totalBytesSent / expected : 0;
              onProgress(Math.min(1, Math.max(0, ratio)));
            }
          : undefined,
      );
      let rejectInterruption!: (error: Error) => void;
      const interruption = new Promise<never>((_resolve, reject) => {
        rejectInterruption = reject;
      });
      const cancel = () => {
        rejectInterruption(new Error('Cover recognition cancelled'));
        void task.cancelAsync().catch(() => undefined);
      };
      if (externalSignal?.aborted) {
        cancel();
      } else {
        externalSignal?.addEventListener('abort', cancel, { once: true });
      }
      const timeout = setTimeout(() => {
        rejectInterruption(new Error('Cover recognition timed out'));
        void task.cancelAsync().catch(() => undefined);
      }, options.timeoutMs);
      try {
        const response = await Promise.race([task.uploadAsync(), interruption]);
        if (!response) {
          throw new Error('Could not reach cover recognition');
        }
        if (response.status < 200 || response.status >= 300) {
          throw new Error(errorMessageForStatus(response.status));
        }
        try {
          return decodeCoverRecognitionResult(JSON.parse(response.body));
        } catch (error) {
          if (error instanceof ContractError) {
            throw error;
          }
          throw new ContractError('Cover response was not valid JSON');
        }
      } finally {
        clearTimeout(timeout);
        externalSignal?.removeEventListener('abort', cancel);
      }
    },
  };
}

export function decodeCoverRecognitionResult(value: unknown): CoverRecognitionResult {
  if (
    !isRecord(value)
    || !isStatus(value.status)
    || !isConfidence(value.confidence)
    || !isNullableString(value.extractedTitle)
    || !isNullableString(value.extractedAuthor)
    || !Array.isArray(value.candidates)
    || !isStringArray(value.providerFailures)
  ) {
    throw new ContractError('Cover response did not match the contract');
  }
  return {
    status: value.status,
    confidence: value.confidence,
    extractedTitle: value.extractedTitle,
    extractedAuthor: value.extractedAuthor,
    candidates: value.candidates.map(decodeMetadataCandidate),
    providerFailures: value.providerFailures,
  };
}

function errorMessageForStatus(status: number): string {
  if (status === 413) return 'Cover image is too large';
  if (status === 415 || status === 422) return 'That cover image could not be read';
  if (status === 504) return 'Cover recognition timed out';
  return 'Cover recognition is unavailable';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isStatus(value: unknown): value is CoverRecognitionResult['status'] {
  return value === 'matched' || value === 'ambiguous' || value === 'no_match';
}

function isConfidence(value: unknown): value is CoverRecognitionResult['confidence'] {
  return value === 'high' || value === 'medium' || value === 'low';
}
