import { decodeCoverRecognitionResult, type CoverClient } from './cover';
export function createExpoCoverClient(baseUrl: string): CoverClient {
  return {
    async recognize(uri, signal, onProgress) {
      const blob = await (await fetch(uri, { signal })).blob();
      onProgress?.(0.2);
      const response = await fetch(`${baseUrl}/covers/recognize`, {
        method: 'POST',
        body: blob,
        headers: { 'Content-Type': 'image/jpeg' },
        signal,
      });
      if (!response.ok)
        throw new Error('The cover could not be read. Try a clearer photo or search by title.');
      onProgress?.(1);
      return decodeCoverRecognitionResult(await response.json());
    },
  };
}
