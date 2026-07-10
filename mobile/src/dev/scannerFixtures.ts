import type { ScannerFixture } from '../scanner/ScannerScreen';

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
} satisfies Record<string, ScannerFixture>;
