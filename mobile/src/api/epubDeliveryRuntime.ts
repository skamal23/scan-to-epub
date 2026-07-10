import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

import { createEpubDeliveryClient } from './epubDelivery';


export function createExpoEpubDeliveryClient(baseUrl: string) {
  if (!FileSystem.cacheDirectory) {
    throw new Error('Temporary file storage is unavailable');
  }
  return createEpubDeliveryClient({
    baseUrl,
    transport: {
      cacheDirectory: FileSystem.cacheDirectory,
      createDownload(url, fileUri, headers, onProgress) {
        const task = FileSystem.createDownloadResumable(
          url,
          fileUri,
          { headers },
          (progress) => onProgress({
            totalBytesWritten: progress.totalBytesWritten,
            totalBytesExpectedToWrite: progress.totalBytesExpectedToWrite,
          }),
        );
        return {
          async downloadAsync() {
            const result = await task.downloadAsync();
            if (!result) return undefined;
            return {
              uri: result.uri,
              status: result.status,
              mimeType: result.mimeType,
              headers: result.headers,
            };
          },
          cancelAsync: () => task.cancelAsync(),
        };
      },
      async readBytes(uri) {
        return new Uint8Array(await new File(uri).bytes());
      },
      deleteFile(uri) {
        return FileSystem.deleteAsync(uri, { idempotent: true });
      },
    },
    sharing: {
      isAvailable: Sharing.isAvailableAsync,
      share: Sharing.shareAsync,
    },
    async hashBytes(bytes) {
      const ownedBytes = new Uint8Array(bytes.byteLength);
      ownedBytes.set(bytes);
      return _hex(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, ownedBytes));
    },
  });
}

function _hex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (value) => value.toString(16).padStart(2, '0')).join('');
}
