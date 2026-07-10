import type { EpubDeliveryInfo } from './editions';


export type EpubDownloadProgress = {
  receivedBytes: number;
  expectedBytes: number | null;
  fraction: number | null;
};

export type EpubDownloadResponse = {
  uri: string;
  status: number;
  mimeType: string | null;
  headers: Record<string, string>;
};

export type DownloadedEpub = { uri: string; filename: string };

type NativeProgress = { totalBytesWritten: number; totalBytesExpectedToWrite: number };
type ResumableDownload = {
  downloadAsync(): Promise<EpubDownloadResponse | undefined>;
  cancelAsync(): Promise<void>;
};
type DeliveryTransport = {
  cacheDirectory: string;
  createDownload(
    url: string,
    fileUri: string,
    headers: Record<string, string>,
    onProgress: (progress: NativeProgress) => void,
  ): ResumableDownload;
  readBytes(uri: string): Promise<Uint8Array>;
  deleteFile(uri: string): Promise<void>;
};
type SharingTransport = {
  isAvailable(): Promise<boolean>;
  share(uri: string, options: { UTI: string }): Promise<void>;
};

export type EpubDownloadTask = {
  start(): Promise<DownloadedEpub>;
  cancel(): Promise<void>;
};

export type EpubDeliveryClient = {
  createDownload(
    delivery: EpubDeliveryInfo,
    onProgress: (progress: EpubDownloadProgress) => void,
  ): EpubDownloadTask;
  shareEpub(uri: string): Promise<void>;
  cleanup(uri: string): Promise<void>;
};

export type EpubDeliveryErrorCode =
  | 'cancelled'
  | 'download'
  | 'expired'
  | 'integrity'
  | 'sharing-unavailable';

export class EpubDeliveryError extends Error {
  constructor(readonly code: EpubDeliveryErrorCode, message: string) {
    super(message);
    this.name = 'EpubDeliveryError';
  }
}

export function createEpubDeliveryClient(options: {
  baseUrl: string;
  transport: DeliveryTransport;
  sharing: SharingTransport;
  hashBytes(bytes: Uint8Array): Promise<string>;
}): EpubDeliveryClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  return {
    createDownload(delivery, onProgress) {
      const fileUri = `${options.transport.cacheDirectory}${delivery.filename}`;
      const download = options.transport.createDownload(
        `${baseUrl}${delivery.downloadPath}`,
        fileUri,
        { Authorization: `Bearer ${delivery.downloadToken}` },
        (progress) => {
          const expectedBytes = progress.totalBytesExpectedToWrite > 0
            ? progress.totalBytesExpectedToWrite
            : null;
          onProgress({
            receivedBytes: progress.totalBytesWritten,
            expectedBytes,
            fraction: expectedBytes === null
              ? null
              : Math.min(1, progress.totalBytesWritten / expectedBytes),
          });
        },
      );
      let cancelled = false;
      return {
        async start() {
          try {
            if (cancelled) throw new EpubDeliveryError('cancelled', 'EPUB download was cancelled');
            await options.transport.deleteFile(fileUri);
            const response = await download.downloadAsync();
            if (cancelled || response === undefined) {
              throw new EpubDeliveryError('cancelled', 'EPUB download was cancelled');
            }
            if (response.status === 410) {
              throw new EpubDeliveryError('expired', 'This download link expired. Check the edition again.');
            }
            if (response.status !== 200) {
              throw new EpubDeliveryError('download', 'The verified EPUB could not be downloaded.');
            }
            if (response.mimeType?.split(';')[0].trim().toLowerCase() !== 'application/epub+zip') {
              throw new EpubDeliveryError('integrity', 'The downloaded file was not an EPUB.');
            }
            if (_header(response.headers, 'x-content-sha256') !== delivery.sha256) {
              throw new EpubDeliveryError('integrity', 'The EPUB identity could not be confirmed.');
            }
            const bytes = await options.transport.readBytes(response.uri);
            if (bytes.length !== delivery.contentLength) {
              throw new EpubDeliveryError('integrity', 'The downloaded EPUB did not match its verified size.');
            }
            const actualHash = (await options.hashBytes(bytes)).toLowerCase();
            if (actualHash !== delivery.sha256) {
              throw new EpubDeliveryError('integrity', 'The downloaded EPUB did not pass integrity checks.');
            }
            return { uri: response.uri, filename: delivery.filename };
          } catch (error) {
            await options.transport.deleteFile(fileUri);
            if (error instanceof EpubDeliveryError) throw error;
            throw new EpubDeliveryError('download', 'The verified EPUB could not be downloaded.');
          }
        },
        async cancel() {
          cancelled = true;
          await download.cancelAsync();
        },
      };
    },
    async shareEpub(uri) {
      if (!await options.sharing.isAvailable()) {
        throw new EpubDeliveryError('sharing-unavailable', 'Sharing is not available on this device.');
      }
      await options.sharing.share(uri, { UTI: 'org.idpf.epub-container' });
    },
    cleanup(uri) {
      return options.transport.deleteFile(uri);
    },
  };
}

function _header(headers: Record<string, string>, name: string): string | undefined {
  return Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1];
}
