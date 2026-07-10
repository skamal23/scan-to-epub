import {
  initialScannerState,
  scannerReducer,
  type ScannerState,
} from '../scannerState';

const pride = '9780141439518';
const moby = '9780199535729';

function observe(state: ScannerState, data: string, at: number, type = 'ean13') {
  return scannerReducer(state, {
    type: 'observed',
    observation: { type, data },
    at,
  });
}

describe('scannerReducer', () => {
  test('accepts three stable observations automatically', () => {
    const one = observe(initialScannerState, pride, 0);
    const two = observe(one, pride, 300);
    const three = observe(two, pride, 600);

    expect(one).toMatchObject({ stableCount: 1, accepted: null, lastValidIsbn: pride });
    expect(two).toMatchObject({ stableCount: 2, accepted: null });
    expect(three).toMatchObject({
      locked: true,
      accepted: { isbn: pride, source: 'automatic' },
    });
  });

  test('resets stability for a different or stale valid observation', () => {
    const first = observe(initialScannerState, pride, 0);
    const different = observe(first, moby, 200);
    const stale = observe(different, moby, 2000);

    expect(different).toMatchObject({
      stableCount: 1,
      lastValidIsbn: moby,
      accepted: null,
      message: 'Barcode changed. Hold one ISBN steady.',
    });
    expect(stale).toMatchObject({ stableCount: 1, lastValidIsbn: moby, accepted: null });
  });

  test('rejects invalid ISBNs and ignores other barcode types', () => {
    const invalid = observe(initialScannerState, '9780141439519', 0);
    const qr = observe(initialScannerState, pride, 0, 'qr');

    expect(invalid).toMatchObject({
      stableCount: 0,
      lastValidIsbn: null,
      message: 'That barcode is not a valid ISBN.',
    });
    expect(qr).toEqual(initialScannerState);
  });

  test('manual capture accepts the latest valid observation', () => {
    const observed = observe(initialScannerState, pride, 0);
    const accepted = scannerReducer(observed, { type: 'manualCapture', at: 500 });

    expect(accepted).toMatchObject({
      locked: true,
      accepted: { isbn: pride, source: 'manual' },
    });
  });

  test('manual capture without a valid observation gives useful guidance', () => {
    expect(scannerReducer(initialScannerState, { type: 'manualCapture', at: 0 })).toMatchObject({
      locked: false,
      accepted: null,
      message: 'Point the camera at an ISBN barcode first.',
    });
  });

  test('suppresses every observation after capture', () => {
    const accepted = scannerReducer(observe(initialScannerState, pride, 0), {
      type: 'manualCapture',
      at: 100,
    });

    expect(observe(accepted, moby, 100)).toEqual(accepted);
    expect(scannerReducer(accepted, { type: 'manualCapture', at: 100 })).toEqual(accepted);
  });

  test('manual capture rejects a stale observation', () => {
    const observed = observe(initialScannerState, pride, 0);

    expect(scannerReducer(observed, { type: 'manualCapture', at: 2000 })).toMatchObject({
      accepted: null,
      locked: false,
      message: 'The ISBN moved out of view. Point at it again.',
    });
  });
});
