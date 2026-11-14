import * as FileSystem from 'expo-file-system/legacy';

import { createCoverClient, type CreateUploadTask } from './cover';


export function createExpoCoverClient(baseUrl: string) {
  return createCoverClient({
    baseUrl,
    createUploadTask: FileSystem.createUploadTask as unknown as CreateUploadTask,
    timeoutMs: 40_000,
  });
}
