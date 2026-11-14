import { createEpubDeliveryClient } from './epubDelivery';

export function createExpoEpubDeliveryClient(baseUrl: string) {
  const files = new Map<string, string>();
  return createEpubDeliveryClient({
    baseUrl,
    transport: {
      cacheDirectory: 'browser:',
      createDownload(url, fileUri, headers, onProgress) {
        const controller = new AbortController();
        return {
          async downloadAsync() {
            const response = await fetch(url, {
              headers,
              signal: controller.signal,
            });
            const blob = await response.blob();
            onProgress({
              totalBytesWritten: blob.size,
              totalBytesExpectedToWrite: blob.size,
            });
            const uri = URL.createObjectURL(blob);
            files.set(fileUri, uri);
            return {
              uri,
              status: response.status,
              mimeType: blob.type,
              headers: Object.fromEntries(response.headers.entries()),
            };
          },
          async cancelAsync() {
            controller.abort();
          },
        };
      },
      async readBytes(uri) {
        return new Uint8Array(await (await fetch(uri)).arrayBuffer());
      },
      async deleteFile(uri) {
        const blobUri = files.get(uri) ?? uri;
        URL.revokeObjectURL(blobUri);
        for (const [key, value] of files) if (key === uri || value === uri) files.delete(key);
      },
    },
    sharing: {
      async isAvailable() {
        return false;
      },
      async share() {},
    },
    async hashBytes(bytes) {
      return Array.from(
        new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))),
        (value) => value.toString(16).padStart(2, '0'),
      ).join('');
    },
  });
}
