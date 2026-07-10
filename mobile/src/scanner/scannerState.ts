import { normalizeScannedISBN } from './isbnScanner';

const REQUIRED_STABLE_OBSERVATIONS = 3;
export const STABILITY_WINDOW_MS = 1200;

export type ScannerState = {
  stableCount: number;
  lastValidIsbn: string | null;
  lastObservedAt: number | null;
  locked: boolean;
  accepted: { isbn: string; source: 'automatic' | 'manual' } | null;
  message: string;
};

export type ScannerAction =
  | {
      type: 'observed';
      observation: { type: string; data: string };
      at: number;
    }
  | { type: 'manualCapture'; at: number }
  | { type: 'reset' };

export const initialScannerState: ScannerState = {
  stableCount: 0,
  lastValidIsbn: null,
  lastObservedAt: null,
  locked: false,
  accepted: null,
  message: 'Frame the front cover, or show the back barcode.',
};

export function hasFreshISBN(state: ScannerState, at: number): boolean {
  return Boolean(
    state.lastValidIsbn
    && state.lastObservedAt !== null
    && at - state.lastObservedAt <= STABILITY_WINDOW_MS,
  );
}

export function scannerReducer(state: ScannerState, action: ScannerAction): ScannerState {
  if (action.type === 'reset') {
    return initialScannerState;
  }
  if (state.locked) {
    return state;
  }
  if (action.type === 'manualCapture') {
    if (!state.lastValidIsbn) {
      return { ...state, message: 'Point the camera at an ISBN barcode first.' };
    }
    if (state.lastObservedAt === null || action.at - state.lastObservedAt > STABILITY_WINDOW_MS) {
      return {
        ...state,
        stableCount: 0,
        lastValidIsbn: null,
        message: 'The ISBN moved out of view. Point at it again.',
      };
    }
    return {
      ...state,
      locked: true,
      accepted: { isbn: state.lastValidIsbn, source: 'manual' },
      message: 'ISBN captured.',
    };
  }
  if (action.observation.type !== 'ean13') {
    return state;
  }
  const isbn = normalizeScannedISBN(action.observation.data);
  if (!isbn) {
    return {
      ...state,
      stableCount: 0,
      lastValidIsbn: null,
      lastObservedAt: action.at,
      message: 'That barcode is not a valid ISBN.',
    };
  }
  const isStable = state.lastValidIsbn === isbn
    && state.lastObservedAt !== null
    && action.at - state.lastObservedAt <= STABILITY_WINDOW_MS;
  const changedBarcode = state.lastValidIsbn !== null && state.lastValidIsbn !== isbn;
  const stableCount = isStable ? state.stableCount + 1 : 1;
  if (stableCount >= REQUIRED_STABLE_OBSERVATIONS) {
    return {
      stableCount,
      lastValidIsbn: isbn,
      lastObservedAt: action.at,
      locked: true,
      accepted: { isbn, source: 'automatic' },
      message: 'ISBN captured.',
    };
  }
  return {
    ...state,
    stableCount,
    lastValidIsbn: isbn,
    lastObservedAt: action.at,
    message: changedBarcode
      ? 'Barcode changed. Hold one ISBN steady.'
      : stableCount === 1
        ? 'ISBN found. Hold steady…'
        : 'Almost there. Hold steady…',
  };
}
