import type { ScannerFixture } from '../scanner/ScannerScreen';
import { metadataScenarios } from './metadataScenarios';

const granted = {
  granted: true,
  status: 'granted' as const,
  canAskAgain: true,
};

export const scannerFixtures = {
  permissionPrompt: {
    permission: { granted: false, status: 'undetermined', canAskAgain: true },
  },
  permissionDenied: {
    permission: { granted: false, status: 'denied', canAskAgain: true },
  },
  permissionBlocked: {
    permission: { granted: false, status: 'denied', canAskAgain: false },
  },
  invalid: {
    permission: granted,
    observations: [{ type: 'ean13', data: '9780141439519', at: 0 }],
  },
  unstable: {
    permission: granted,
    observations: [
      { type: 'ean13', data: '9780141439518', at: 0 },
      { type: 'ean13', data: '9780199535729', at: 250 },
      { type: 'ean13', data: '9780141439518', at: 500 },
    ],
  },
  singleValid: {
    permission: granted,
    observations: [{ type: 'ean13', data: '9780141439518', at: 0 }],
  },
  repeatedValid: {
    permission: granted,
    observations: [
      { type: 'ean13', data: '9780141439518', at: 0 },
      { type: 'ean13', data: '9780141439518', at: 250 },
      { type: 'ean13', data: '9780141439518', at: 500 },
    ],
  },
  coverStrong: {
    permission: granted,
    coverResult: {
      status: 'matched',
      confidence: 'high',
      extractedTitle: 'Pride and Prejudice',
      extractedAuthor: 'Jane Austen',
      candidates: metadataScenarios.one.map((candidate) => ({
        ...candidate,
        matchReasons: ['Title match', 'Author match', 'Cover match'],
      })),
      providerFailures: [],
    },
  },
  coverAmbiguous: {
    permission: granted,
    coverResult: {
      status: 'ambiguous',
      confidence: 'medium',
      extractedTitle: 'Invisible Man',
      extractedAuthor: null,
      candidates: metadataScenarios.ambiguous,
      providerFailures: [],
    },
  },
  coverNoMatch: {
    permission: granted,
    coverResult: {
      status: 'no_match',
      confidence: 'low',
      extractedTitle: null,
      extractedAuthor: null,
      candidates: [],
      providerFailures: [],
    },
  },
  coverTimeout: {
    permission: granted,
    coverError: 'Cover recognition timed out',
  },
  coverOffline: {
    permission: granted,
    coverError: 'Could not reach cover recognition',
  },
  coverProcessing: {
    permission: granted,
    coverDelayMs: 5000,
    coverResult: {
      status: 'matched',
      confidence: 'high',
      extractedTitle: 'Pride and Prejudice',
      extractedAuthor: 'Jane Austen',
      candidates: metadataScenarios.one,
      providerFailures: [],
    },
  },
} satisfies Record<string, ScannerFixture>;
