import { fireEvent, render } from '@testing-library/react-native';

import type { EditionResolutionResult } from '../../api/editions';
import { metadataScenarios } from '../../dev/metadataScenarios';
import type { EditionState } from '../../state/editionState';
import { initialExportState, type ExportState } from '../../state/exportState';
import { EditionResolutionFlow } from '../EditionResolutionFlow';


const ready: EditionResolutionResult = {
  status: 'ready',
  reason: null,
  physicalEdition: {
    candidateId: 'fixture-pride', title: 'Pride and Prejudice', authors: ['Jane Austen'],
    isbn13: '9780141439518', publisher: 'Penguin Classics', publishedDate: '2003', sourceIds: {},
  },
  digitalEdition: {
    title: 'Pride and Prejudice', authors: ['Jane Austen'], language: 'en-GB',
    identifier: 'https://standardebooks.org/ebooks/jane-austen/pride-and-prejudice',
    publisher: 'Standard Ebooks', coverUrl: 'https://standardebooks.org/cover.jpg',
    isSamePublication: false,
  },
  source: { organization: 'Standard Ebooks', canonicalUrl: 'https://standardebooks.org/book' },
  rights: {
    licenseName: 'CC0 1.0 Universal', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    rightsStatement: 'Reviewed public-domain edition.', attribution: 'Jane Austen, public domain.', territory: 'US',
  },
  provenance: {
    catalogEntryId: 'standardebooks:pride', catalogReviewedAt: '2026-07-10',
    acquisitionUrl: 'https://standardebooks.org/book.epub?source=download',
    retrievedAt: '2026-07-10T18:00:00Z', originalSha256: 'a'.repeat(64), finalSha256: 'a'.repeat(64),
    transformation: 'unchanged', epubcheckVersion: '5.3.0', epubcheckStatus: 'valid', epubcheckWarnings: [], sourceAttempts: ['Standard Ebooks'],
    generatedAt: null,
    generatorVersion: null, transformationSteps: [],
  },
  delivery: {
    downloadPath: '/editions/download', downloadToken: 'fixture-download-token-which-is-long-enough-to-be-opaque',
    filename: 'Pride-and-Prejudice-Jane-Austen.epub', contentLength: 1234,
    sha256: 'a'.repeat(64), expiresAt: '2026-07-10T18:10:00Z',
  },
};

const props = {
  candidate: metadataScenarios.one[0],
  onBack: jest.fn(),
  onRetry: jest.fn(),
  onScanAnother: jest.fn(),
  exportState: initialExportState,
  onExport: jest.fn(),
  onCancelExport: jest.fn(),
  onRetryExport: jest.fn(),
  onRefreshEdition: jest.fn(),
};

test('searching state preserves the confirmed physical edition', () => {
  const state: EditionState = { status: 'searching', result: null, message: null };
  const view = render(<EditionResolutionFlow {...props} state={state} />);

  expect(view.getByText('Work confirmed')).toBeTruthy();
  expect(view.getByText('Checking reviewed sources and analyzing a PDF safely where needed…')).toBeTruthy();
  expect(view.getByText('Your physical edition')).toBeTruthy();
  expect(view.getByText('Penguin Classics, 2003')).toBeTruthy();
});

test('ready state shows verified digital edition and auditable rights details', () => {
  const state: EditionState = { status: 'resolved', result: ready, message: null };
  const view = render(<EditionResolutionFlow {...props} state={state} />);

  expect(view.getByText('Verified open edition')).toBeTruthy();
  expect(view.getByText('Standard Ebooks')).toBeTruthy();
  expect(view.getByText(/may differ from your physical copy/i)).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: 'Open in Books' }));
  expect(props.onExport).toHaveBeenCalledWith('books');
  fireEvent.press(view.getByRole('button', { name: 'Save to Files' }));
  expect(props.onExport).toHaveBeenCalledWith('files');
  fireEvent.press(view.getByRole('button', { name: 'Why this edition is available' }));
  expect(view.getByText('CC0 1.0 Universal')).toBeTruthy();
  expect(view.getByText('United States')).toBeTruthy();
  expect(view.getByText('EPUBCheck 5.3.0 · Valid')).toBeTruthy();
  expect(view.getByText('2026-07-10T18:00:00Z')).toBeTruthy();
  expect(view.getByText(`SHA-256 ${'a'.repeat(12)}…`)).toBeTruthy();
  expect(view.getByText('Jane Austen, public domain.')).toBeTruthy();
});


test('uses an explicit placeholder when the source does not authorize a reusable cover', () => {
  const noCover: EditionResolutionResult = {
    ...ready,
    digitalEdition: { ...ready.digitalEdition!, coverUrl: null },
  };
  const view = render(
    <EditionResolutionFlow
      {...props}
      state={{ status: 'resolved', result: noCover, message: null }}
    />,
  );

  expect(view.getByText('No reusable source cover')).toBeTruthy();
});


test('labels a generated source-to-EPUB result without implying it was downloaded unchanged', () => {
  const generated: EditionResolutionResult = {
    ...ready,
    digitalEdition: { ...ready.digitalEdition!, title: 'Structured Open Text', coverUrl: null },
    source: {
      organization: 'Reviewed structured source',
      canonicalUrl: 'https://example.invalid/structured-open-text',
    },
    provenance: {
      ...ready.provenance!,
      originalSha256: 'b'.repeat(64),
      finalSha256: 'c'.repeat(64),
      transformation: 'generated',
      generatedAt: '2026-07-10T18:05:00Z',
      generatorVersion: 'structured-epub/1',
      transformationSteps: ['normalized authorized HTML', 'packaged deterministic EPUB'],
    },
    delivery: { ...ready.delivery!, sha256: 'c'.repeat(64) },
  };
  const view = render(
    <EditionResolutionFlow
      {...props}
      state={{ status: 'resolved', result: generated, message: null }}
    />,
  );

  expect(view.getByText('Generated open edition')).toBeTruthy();
  expect(view.getByText(/converted into this EPUB without AI-generated text/i)).toBeTruthy();
  expect(view.getByText('No reusable source cover')).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: 'Why this edition is available' }));
  expect(view.getByText('Generated from authorized source')).toBeTruthy();
  expect(view.getByText('structured-epub/1')).toBeTruthy();
  expect(view.getByText('2026-07-10T18:05:00Z')).toBeTruthy();
  expect(view.getByText('Source SHA-256 bbbbbbbbbbbb…')).toBeTruthy();
  expect(view.getByText('EPUB SHA-256 cccccccccccc…')).toBeTruthy();
  expect(view.queryByText('Passed through unchanged')).toBeNull();
});


test('explains a verified fallback without presenting a catalog chooser', () => {
  const fallback: EditionResolutionResult = {
    ...ready,
    provenance: { ...ready.provenance!, sourceAttempts: ['Standard Ebooks', 'OAPEN'] },
  };
  const view = render(
    <EditionResolutionFlow
      {...props}
      state={{ status: 'resolved', result: fallback, message: null }}
    />,
  );

  expect(view.getByText('Checked a later approved path after an earlier option could not be delivered.')).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: 'Why this edition is available' }));
  expect(view.getByText('Standard Ebooks → OAPEN')).toBeTruthy();
});

test('shows download progress and lets the user cancel without leaving the confirmed edition', () => {
  const exportState: ExportState = {
    status: 'downloading', intent: 'books', file: null,
    progress: { receivedBytes: 50, expectedBytes: 100, fraction: 0.5 }, message: null, code: null,
  };
  const view = render(<EditionResolutionFlow {...props} state={{ status: 'resolved', result: ready, message: null }} exportState={exportState} />);

  expect(view.getByText('Downloading verified EPUB')).toBeTruthy();
  expect(view.getByText('50%')).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: 'Cancel download' }));
  expect(props.onCancelExport).toHaveBeenCalled();
});

test('treats an expired delivery as a recheck of the same confirmed edition', () => {
  const exportState: ExportState = {
    status: 'error', intent: 'files', file: null, progress: null,
    message: 'This download link expired. Check the edition again.', code: 'expired',
  };
  const view = render(<EditionResolutionFlow {...props} state={{ status: 'resolved', result: ready, message: null }} exportState={exportState} />);

  expect(view.getByText('This download link expired. Check the edition again.')).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: 'Check edition again' }));
  expect(props.onRefreshEdition).toHaveBeenCalled();
});

test('unavailable and error states stay honest and recoverable', () => {
  const unavailable: EditionState = {
    status: 'resolved', message: null,
    result: { status: 'unavailable', reason: 'No reviewed open edition is available for this work yet.', physicalEdition: null, digitalEdition: null, source: null, rights: null, provenance: null, delivery: null },
  };
  const first = render(<EditionResolutionFlow {...props} state={unavailable} />);
  expect(first.getByText('Book identified, open edition unavailable')).toBeTruthy();
  expect(first.queryByText(/shadow|search the web/i)).toBeNull();
  fireEvent.press(first.getByRole('button', { name: 'Scan another book' }));
  expect(props.onScanAnother).toHaveBeenCalled();
  first.unmount();

  const error: EditionState = { status: 'error', result: null, message: 'Source unavailable' };
  const second = render(<EditionResolutionFlow {...props} state={error} />);
  expect(second.getByText('Open-edition check unavailable')).toBeTruthy();
  fireEvent.press(second.getByRole('button', { name: 'Try source check again' }));
  expect(props.onRetry).toHaveBeenCalled();
});

test('explains a safe structured-source conversion refusal without offering an export', () => {
  const refusal: EditionState = {
    status: 'resolved',
    message: null,
    result: {
      status: 'unavailable',
      reason: 'We found an authorized structured source, but could not safely convert it into an EPUB.',
      physicalEdition: ready.physicalEdition,
      digitalEdition: null,
      source: null,
      rights: null,
      provenance: null,
      delivery: null,
    },
  };
  const view = render(<EditionResolutionFlow {...props} state={refusal} />);

  expect(view.getByText('We found an authorized structured source, but could not safely convert it into an EPUB.')).toBeTruthy();
  expect(view.queryByRole('button', { name: 'Open in Books' })).toBeNull();
  expect(view.queryByRole('button', { name: 'Save to Files' })).toBeNull();
});
