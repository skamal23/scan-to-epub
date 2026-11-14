import { Platform } from 'react-native';
import { metadataScenarios } from './metadataScenarios';
import { readyEditionScenario, unavailableEditionScenario } from './editionScenarios';
import type { MetadataClient } from '../api/metadata';
import type { EditionClient } from '../api/editions';
import type { ScannerFixture } from '../scanner/ScannerScreen';

// Browser-only and development-only. Live builds never select simulated services.
export const demoScenario =
  __DEV__ && Platform.OS === 'web' && typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('demo')
    : null;
const demoCandidates = metadataScenarios.one.map((book) => ({
  ...book,
  edition: { ...book.edition, coverUrl: '/demo/pride-and-prejudice.jpg' },
}));
const delay = (signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const cancel = () => {
      clearTimeout(timer);
      reject(new Error('Cancelled'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', cancel);
      resolve();
    }, 120);
    if (signal?.aborted) cancel();
    else signal?.addEventListener('abort', cancel, { once: true });
  });
export const demoMetadata: MetadataClient = {
  async search(_query, signal) {
    await delay(signal);
    if (demoScenario === 'offline')
      throw new Error(
        'You’re offline. Reconnect to find books; your saved books are still available.',
      );
    return {
      candidates:
        demoScenario === 'no-match'
          ? []
          : demoScenario === 'ambiguous'
            ? metadataScenarios.ambiguous
            : demoScenario === 'long-title'
              ? metadataScenarios.longTitle
              : demoCandidates,
      observedIsbn: null,
      providerFailures: [],
    };
  },
};
export const demoEditions: EditionClient = {
  async resolve(_request, signal) {
    await delay(signal);
    return demoScenario === 'unavailable' || _request.workTitle !== 'Pride and Prejudice'
      ? unavailableEditionScenario
      : {
          ...readyEditionScenario,
          source: {
            organization: 'Project Gutenberg',
            canonicalUrl: 'https://www.gutenberg.org/ebooks/1342',
          },
          rights: {
            ...readyEditionScenario.rights!,
            licenseName: 'Public domain in the USA',
            attribution: 'Project Gutenberg. Original file and license retained.',
          },
        };
  },
};
export const demoScanner: ScannerFixture = {
  permission: {
    granted: demoScenario !== 'permission',
    status: demoScenario === 'permission' ? 'denied' : 'granted',
    canAskAgain: false,
  },
  coverDelayMs: 120,
  coverResult: {
    status: demoScenario === 'no-match' ? 'no_match' : 'matched',
    confidence: 'high',
    extractedTitle: 'Pride and Prejudice',
    extractedAuthor: 'Jane Austen',
    candidates:
      demoScenario === 'no-match'
        ? []
        : demoScenario === 'ambiguous'
          ? metadataScenarios.ambiguous
          : demoScenario === 'long-title'
            ? metadataScenarios.longTitle
            : demoCandidates,
    providerFailures: [],
  },
  ...(demoScenario === 'barcode'
    ? {
        observations: [
          { type: 'ean13', data: '9780141439518', at: 100 },
          { type: 'ean13', data: '9780141439518', at: 250 },
          { type: 'ean13', data: '9780141439518', at: 400 },
        ],
      }
    : {}),
};
