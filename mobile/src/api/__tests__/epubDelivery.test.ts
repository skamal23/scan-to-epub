import {
  EpubDeliveryError,
  createEpubDeliveryClient,
  type EpubDownloadResponse,
} from '../epubDelivery';
import type { EpubDeliveryInfo } from '../editions';


const delivery: EpubDeliveryInfo = {
  downloadPath: '/editions/download',
  downloadToken: 'fixture-download-token-which-is-long-enough-to-be-opaque',
  filename: 'Pride-and-Prejudice-Jane-Austen.epub',
  contentLength: 3,
  sha256: 'a'.repeat(64),
  expiresAt: '2026-07-10T18:10:00Z',
};

function response(overrides: Partial<EpubDownloadResponse> = {}): EpubDownloadResponse {
  return {
    uri: 'file:///cache/Pride-and-Prejudice-Jane-Austen.epub',
    status: 200,
    mimeType: 'application/epub+zip',
    headers: { 'x-content-sha256': delivery.sha256 },
    ...overrides,
  };
}

function setup(overrides: { download?: Promise<EpubDownloadResponse | undefined>; available?: boolean } = {}) {
  const resumable = {
    downloadAsync: jest.fn().mockReturnValue(overrides.download ?? Promise.resolve(response())),
    cancelAsync: jest.fn().mockResolvedValue(undefined),
  };
  const transport = {
    cacheDirectory: 'file:///cache/',
    createDownload: jest.fn((_url, _fileUri, _headers, progress) => {
      progress({ totalBytesWritten: 2, totalBytesExpectedToWrite: 3 });
      return resumable;
    }),
    readBytes: jest.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    deleteFile: jest.fn().mockResolvedValue(undefined),
  };
  const sharing = {
    isAvailable: jest.fn().mockResolvedValue(overrides.available ?? true),
    share: jest.fn().mockResolvedValue(undefined),
  };
  const hashBytes = jest.fn().mockResolvedValue(delivery.sha256);
  return {
    client: createEpubDeliveryClient({ baseUrl: 'http://localhost:8000/', transport, sharing, hashBytes }),
    transport,
    resumable,
    sharing,
    hashBytes,
  };
}


test('downloads through the fixed endpoint, reports progress, and verifies the exact EPUB before sharing', async () => {
  const { client, transport, hashBytes } = setup();
  const progress = jest.fn();

  const file = await client.createDownload(delivery, progress).start();

  expect(transport.createDownload).toHaveBeenCalledWith(
    'http://localhost:8000/editions/download',
    'file:///cache/Pride-and-Prejudice-Jane-Austen.epub',
    { Authorization: `Bearer ${delivery.downloadToken}` },
    expect.any(Function),
  );
  expect(progress).toHaveBeenCalledWith({ receivedBytes: 2, expectedBytes: 3, fraction: 2 / 3 });
  expect(transport.readBytes).toHaveBeenCalledWith(file.uri);
  expect(hashBytes).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]));
  expect(file).toEqual({ uri: 'file:///cache/Pride-and-Prejudice-Jane-Austen.epub', filename: delivery.filename });
});


test('removes a file that fails its hash or size check', async () => {
  const { client, transport } = setup();
  transport.readBytes.mockResolvedValue(new Uint8Array([1, 2]));

  await expect(client.createDownload(delivery, jest.fn()).start())
    .rejects.toMatchObject({ code: 'integrity' } satisfies Partial<EpubDeliveryError>);

  expect(transport.deleteFile).toHaveBeenCalledWith('file:///cache/Pride-and-Prejudice-Jane-Austen.epub');
});


test('treats an expired credential and a cancelled task as recoverable download outcomes', async () => {
  const expired = setup({ download: Promise.resolve(response({ status: 410 })) });
  await expect(expired.client.createDownload(delivery, jest.fn()).start())
    .rejects.toMatchObject({ code: 'expired' } satisfies Partial<EpubDeliveryError>);

  const cancelled = setup({ download: Promise.resolve(undefined) });
  const task = cancelled.client.createDownload(delivery, jest.fn());
  await task.cancel();
  await expect(task.start()).rejects.toMatchObject({ code: 'cancelled' } satisfies Partial<EpubDeliveryError>);
  expect(cancelled.resumable.cancelAsync).toHaveBeenCalled();
});


test('uses the native EPUB UTI for the iOS share sheet and fails clearly when sharing is unavailable', async () => {
  const supported = setup();
  await supported.client.shareEpub('file:///cache/book.epub');
  expect(supported.sharing.share).toHaveBeenCalledWith('file:///cache/book.epub', {
    UTI: 'org.idpf.epub-container',
  });

  const unavailable = setup({ available: false });
  await expect(unavailable.client.shareEpub('file:///cache/book.epub'))
    .rejects.toMatchObject({ code: 'sharing-unavailable' } satisfies Partial<EpubDeliveryError>);
});
