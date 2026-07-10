import type { EpubDeliveryInfo } from '../editions';

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  createDownloadResumable: jest.fn(),
  deleteAsync: jest.fn(),
}));
jest.mock('expo-file-system', () => ({ File: jest.fn() }));
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digest: jest.fn(),
}));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(),
  shareAsync: jest.fn(),
}));

import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

import { createExpoEpubDeliveryClient } from '../epubDeliveryRuntime';


const delivery: EpubDeliveryInfo = {
  downloadPath: '/editions/download',
  downloadToken: 'fixture-download-token-which-is-long-enough-to-be-opaque',
  filename: 'Pride-and-Prejudice-Jane-Austen.epub',
  contentLength: 3,
  sha256: 'a'.repeat(64),
  expiresAt: '2026-07-10T18:10:00Z',
};


beforeEach(() => {
  jest.clearAllMocks();
  (FileSystem.deleteAsync as jest.Mock).mockResolvedValue(undefined);
  (FileSystem.createDownloadResumable as jest.Mock).mockReturnValue({
    downloadAsync: jest.fn().mockResolvedValue({
      uri: 'file:///cache/Pride-and-Prejudice-Jane-Austen.epub',
      status: 200,
      mimeType: 'application/epub+zip',
      headers: { 'x-content-sha256': delivery.sha256 },
    }),
    cancelAsync: jest.fn().mockResolvedValue(undefined),
  });
  (File as unknown as jest.Mock).mockImplementation(() => ({ bytes: jest.fn().mockResolvedValue(new Uint8Array([1, 2, 3])) }));
  (Crypto.digest as jest.Mock).mockResolvedValue(new Uint8Array(32).fill(0xaa).buffer);
  (Sharing.isAvailableAsync as jest.Mock).mockResolvedValue(true);
  (Sharing.shareAsync as jest.Mock).mockResolvedValue(undefined);
});


test('adapts Expo Go filesystem, crypto, and sharing APIs to a verified EPUB handoff', async () => {
  const client = createExpoEpubDeliveryClient('http://localhost:8000');

  const file = await client.createDownload(delivery, jest.fn()).start();
  await client.shareEpub(file.uri);

  expect(Crypto.digest).toHaveBeenCalledWith('SHA-256', new Uint8Array([1, 2, 3]));
  expect(Sharing.shareAsync).toHaveBeenCalledWith(file.uri, { UTI: 'org.idpf.epub-container' });
});
