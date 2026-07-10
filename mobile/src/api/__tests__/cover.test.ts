import {
  ContractError,
  createCoverClient,
  decodeCoverRecognitionResult,
} from '../cover';
import { metadataScenarios } from '../../dev/metadataScenarios';


const responseBody = {
  status: 'ambiguous',
  confidence: 'medium',
  extractedTitle: 'Frankenstein',
  extractedAuthor: 'Mary Shelley',
  candidates: metadataScenarios.ambiguous,
  providerFailures: [],
};


test('decodes the cover recognition contract', () => {
  expect(decodeCoverRecognitionResult(responseBody)).toEqual(responseBody);
  expect(() => decodeCoverRecognitionResult({ ...responseBody, confidence: 'certain' }))
    .toThrow(ContractError);
  expect(() => decodeCoverRecognitionResult({ ...responseBody, extractedTitle: 4 }))
    .toThrow(ContractError);
});


test('uploads only the image URI as a binary JPEG and reports progress', async () => {
  const uploadAsync = jest.fn().mockResolvedValue({
    status: 200,
    body: JSON.stringify(responseBody),
  });
  const createUploadTask = jest.fn((_url, _uri, _options, callback) => {
    callback({ totalBytesSent: 50, totalBytesExpectedToSend: 100 });
    return { uploadAsync, cancelAsync: jest.fn() };
  });
  const progress = jest.fn();
  const client = createCoverClient({
    baseUrl: 'http://127.0.0.1:8000/',
    createUploadTask,
    timeoutMs: 5000,
  });

  await expect(client.recognize('file:///cache/cover.jpg', undefined, progress))
    .resolves.toEqual(responseBody);

  expect(createUploadTask).toHaveBeenCalledWith(
    'http://127.0.0.1:8000/covers/recognize',
    'file:///cache/cover.jpg',
    expect.objectContaining({
      headers: { Accept: 'application/json' },
      httpMethod: 'POST',
      mimeType: 'image/jpeg',
      uploadType: 0,
    }),
    expect.any(Function),
  );
  expect(progress).toHaveBeenCalledWith(0.5);
});


test('cancels the native upload when the caller aborts', async () => {
  let resolveUpload!: (value: { status: number; body: string }) => void;
  const pending = new Promise<{ status: number; body: string }>((resolve) => {
    resolveUpload = resolve;
  });
  const cancelAsync = jest.fn().mockImplementation(async () => {
    resolveUpload({ status: 0, body: '' });
  });
  const createUploadTask = jest.fn(() => ({
    uploadAsync: () => pending,
    cancelAsync,
  }));
  const client = createCoverClient({
    baseUrl: 'http://localhost:8000',
    createUploadTask,
    timeoutMs: 5000,
  });
  const controller = new AbortController();

  const recognition = client.recognize('file:///cover.jpg', controller.signal);
  controller.abort();

  await expect(recognition).rejects.toThrow('Cover recognition cancelled');
  expect(cancelAsync).toHaveBeenCalledTimes(1);
});

test('rejects at the deadline even if native cancellation does not settle the upload', async () => {
  jest.useFakeTimers();
  const cancelAsync = jest.fn().mockResolvedValue(undefined);
  const createUploadTask = jest.fn(() => ({
    uploadAsync: () => new Promise<never>(() => undefined),
    cancelAsync,
  }));
  const client = createCoverClient({
    baseUrl: 'http://localhost:8000',
    createUploadTask,
    timeoutMs: 100,
  });

  const recognition = client.recognize('file:///cover.jpg');
  jest.advanceTimersByTime(100);

  await expect(recognition).rejects.toThrow('Cover recognition timed out');
  expect(cancelAsync).toHaveBeenCalledTimes(1);
  jest.useRealTimers();
});


test('maps timeout, image, and server errors to concise recovery messages', async () => {
  const task = (status: number, body = '') => jest.fn(() => ({
    uploadAsync: jest.fn().mockResolvedValue({ status, body }),
    cancelAsync: jest.fn(),
  }));
  const options = { baseUrl: 'http://localhost:8000', timeoutMs: 5000 };

  await expect(createCoverClient({ ...options, createUploadTask: task(413) })
    .recognize('file:///cover.jpg')).rejects.toThrow('Cover image is too large');
  await expect(createCoverClient({ ...options, createUploadTask: task(422) })
    .recognize('file:///cover.jpg')).rejects.toThrow('That cover image could not be read');
  await expect(createCoverClient({ ...options, createUploadTask: task(504) })
    .recognize('file:///cover.jpg')).rejects.toThrow('Cover recognition timed out');
  await expect(createCoverClient({ ...options, createUploadTask: task(500) })
    .recognize('file:///cover.jpg')).rejects.toThrow('Cover recognition is unavailable');
});
