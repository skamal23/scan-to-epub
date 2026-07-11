import { fireEvent, render } from '@testing-library/react-native';
import { AccessibilityInfo, StyleSheet } from 'react-native';

import type { EditionResolutionResult } from '../../api/editions';
import { metadataScenarios } from '../../dev/metadataScenarios';
import type { EditionState } from '../../state/editionState';
import { initialExportState, type ExportState } from '../../state/exportState';
import { colors, radius } from '../../ui/theme';

type MockEntranceProps = {
  children: React.ReactNode;
  testID?: string;
};

const mockEntrance = jest.fn(({ children }: MockEntranceProps) => children);

jest.mock('../../ui/Entrance', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    Entrance: (props: MockEntranceProps) => React.createElement(
      View,
      { testID: props.testID ?? 'entrance' },
      mockEntrance(props),
    ),
  };
});

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

test('searching state keeps the waiting outcome concise', () => {
  const state: EditionState = { status: 'searching', result: null, message: null };
  const view = render(<EditionResolutionFlow {...props} state={state} />);

  expect(view.getByText('Finding a reading copy')).toBeTruthy();
  expect(view.getByText('Looking for a copy you can open…')).toBeTruthy();
  expect(view.queryByText('Your physical edition')).toBeNull();
});


test('marks changing edition states for assistive technologies', () => {
  const searching = render(
    <EditionResolutionFlow
      {...props}
      state={{ status: 'searching', result: null, message: null }}
    />,
  );

  expect(
    searching.getByText('Looking for a copy you can open…')
      .props.accessibilityLiveRegion,
  ).toBe('polite');
  searching.unmount();

  const unavailable: EditionState = {
    status: 'resolved',
    message: null,
    result: {
      status: 'unavailable',
      reason: 'No reviewed open edition is available for this work yet.',
      physicalEdition: null,
      digitalEdition: null,
      source: null,
      rights: null,
      provenance: null,
      delivery: null,
    },
  };
  const refusal = render(<EditionResolutionFlow {...props} state={unavailable} />);

  expect(refusal.getByRole('alert')).toHaveTextContent(
    'Try another book or come back later.',
  );
});

test('ready state keeps the book, outcome, and export choices ahead of Details', () => {
  const state: EditionState = { status: 'resolved', result: ready, message: null };
  const view = render(<EditionResolutionFlow {...props} state={state} />);

  expect(view.getByText('Ready to read')).toBeTruthy();
  expect(view.getByText('Pride and Prejudice').props.accessibilityLiveRegion).toBe('polite');
  expect(view.queryByText('Verified open edition')).toBeNull();
  expect(view.queryByText('Standard Ebooks')).toBeNull();
  expect(view.queryByText('CC0 1.0 Universal')).toBeNull();
  expect(view.queryByText('Passed through unchanged')).toBeNull();
  expect(view.queryByText('EPUBCheck 5.3.0 · Valid')).toBeNull();
  expect(view.queryByText('Penguin Classics, 2003')).toBeNull();
  expect(view.queryByText(/open digital edition may differ/i)).toBeNull();

  const buttons = view.getAllByRole('button');
  expect(buttons.map((button) => button.props.accessibilityLabel)).toEqual([
    'Open in Books',
    'Save to Files',
    'Details',
    'Scan another book',
  ]);

  const books = view.getByRole('button', { name: 'Open in Books' });
  const files = view.getByRole('button', { name: 'Save to Files' });
  fireEvent.press(books);
  expect(props.onExport).toHaveBeenCalledWith('books');
  fireEvent.press(files);
  expect(props.onExport).toHaveBeenCalledWith('files');

  const details = view.getByRole('button', { name: 'Details' });
  expect(details).toBeTruthy();
  expect(view.getByTestId('ready-edition-card').findAllByProps({ accessibilityRole: 'button' })).toHaveLength(0);
  fireEvent.press(details);

  expect(view.getByRole('button', { name: 'Hide details' })).toBeTruthy();
  expect(view.getByText('CC0 1.0 Universal')).toBeTruthy();
  expect(view.getByText('United States')).toBeTruthy();
  expect(view.getByText('EPUBCheck 5.3.0 · Valid')).toBeTruthy();
  expect(view.getByText('2026-07-10T18:00:00Z')).toBeTruthy();
  expect(view.getByText(`SHA-256 ${'a'.repeat(12)}…`)).toBeTruthy();
  expect(view.getByText('Jane Austen, public domain.')).toBeTruthy();
  expect(view.getByText('Penguin Classics, 2003')).toBeTruthy();
  expect(view.getByText(/open digital edition may differ/i)).toBeTruthy();

  expect(StyleSheet.flatten(view.getByTestId('edition-details').props.style)).toMatchObject({
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: radius.card,
    borderWidth: 1,
  });
});


test('announces the actual ready edition title', () => {
  const announce = jest
    .spyOn(AccessibilityInfo, 'announceForAccessibility')
    .mockImplementation(() => undefined);
  announce.mockClear();

  render(
    <EditionResolutionFlow
      {...props}
      state={{ status: 'resolved', result: ready, message: null }}
    />,
  );

  expect(announce).toHaveBeenCalledWith('Pride and Prejudice is ready to read.');
  announce.mockRestore();
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

  expect(view.getByText('No cover available')).toBeTruthy();
});


test('keeps generated-source evidence inside Details without changing the ready path', () => {
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

  expect(view.getByText('Ready to read')).toBeTruthy();
  expect(view.queryByText('Generated open edition')).toBeNull();
  expect(view.queryByText(/converted into this EPUB without AI-generated text/i)).toBeNull();
  expect(view.queryByText('Reviewed structured source')).toBeNull();
  expect(view.getByText('No cover available')).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: 'Details' }));
  expect(view.getByText('Generated from authorized source')).toBeTruthy();
  expect(view.getByText('structured-epub/1')).toBeTruthy();
  expect(view.getByText('2026-07-10T18:05:00Z')).toBeTruthy();
  expect(view.getByText('Source SHA-256 bbbbbbbbbbbb…')).toBeTruthy();
  expect(view.getByText('EPUB SHA-256 cccccccccccc…')).toBeTruthy();
  expect(view.queryByText('Passed through unchanged')).toBeNull();
});


test('keeps fallback provenance in Details without presenting a catalog chooser', () => {
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

  expect(view.queryByText('Checked a later approved path after an earlier option could not be delivered.')).toBeNull();
  fireEvent.press(view.getByRole('button', { name: 'Details' }));
  expect(view.getByText('Checked a later approved path after an earlier option could not be delivered.')).toBeTruthy();
  expect(view.getByText('Standard Ebooks → OAPEN')).toBeTruthy();
});

test('shows download progress and lets the user cancel without leaving the confirmed edition', () => {
  const exportState: ExportState = {
    status: 'downloading', intent: 'books', file: null,
    progress: { receivedBytes: 50, expectedBytes: 100, fraction: 0.5 }, message: null, code: null,
  };
  const view = render(<EditionResolutionFlow {...props} state={{ status: 'resolved', result: ready, message: null }} exportState={exportState} />);

  expect(view.getByText('Getting your book ready')).toBeTruthy();
  expect(view.getByText('Getting your book ready').props.accessibilityLiveRegion).toBe('polite');
  expect(view.getByText('50%').props.accessibilityLiveRegion).toBeUndefined();
  expect(view.getByText('50%')).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: 'Cancel download' }));
  expect(props.onCancelExport).toHaveBeenCalled();
});

test('keeps the share-sheet guidance short and static', () => {
  const exportState: ExportState = {
    status: 'sharing', intent: 'books', file: null,
    progress: null, message: null, code: null,
  };
  const view = render(<EditionResolutionFlow {...props} state={{ status: 'resolved', result: ready, message: null }} exportState={exportState} />);

  expect(view.getByText('Choose Books in the share sheet.')).toBeTruthy();
  expect(view.queryByText('Share sheet open')).toBeNull();
});

test('announces that an EPUB is ready again after the share sheet closes', () => {
  const announce = jest
    .spyOn(AccessibilityInfo, 'announceForAccessibility')
    .mockImplementation(() => undefined);
  announce.mockClear();
  const exportState: ExportState = {
    status: 'ready',
    intent: null,
    file: null,
    progress: null,
    message: 'EPUB is ready to share again.',
    code: null,
  };

  const view = render(
    <EditionResolutionFlow
      {...props}
      state={{ status: 'resolved', result: ready, message: null }}
      exportState={exportState}
    />,
  );

  expect(announce).toHaveBeenCalledWith('EPUB is ready to share again.');
  expect(view.getByText('EPUB is ready to share again.').props.accessibilityLiveRegion).toBe('polite');
  announce.mockRestore();
});

test('treats an expired delivery as a recheck of the same confirmed edition', () => {
  const exportState: ExportState = {
    status: 'error', intent: 'files', file: null, progress: null,
    message: 'This download link expired. Check the edition again.', code: 'expired',
  };
  const view = render(<EditionResolutionFlow {...props} state={{ status: 'resolved', result: ready, message: null }} exportState={exportState} />);

  expect(view.getByText('This download link expired. Check the edition again.')).toBeTruthy();
  expect(view.getByText('This download link expired. Check the edition again.').props.accessibilityRole).toBe('alert');
  fireEvent.press(view.getByRole('button', { name: 'Check edition again' }));
  expect(props.onRefreshEdition).toHaveBeenCalled();
});

test('unavailable and error states stay concise, alerting, and recoverable', () => {
  const unavailable: EditionState = {
    status: 'resolved', message: null,
    result: { status: 'unavailable', reason: 'No reviewed open edition is available for this work yet.', physicalEdition: null, digitalEdition: null, source: null, rights: null, provenance: null, delivery: null },
  };
  const first = render(<EditionResolutionFlow {...props} state={unavailable} />);
  expect(first.getByText('No open edition available')).toBeTruthy();
  expect(first.getByRole('alert')).toHaveTextContent('Try another book or come back later.');
  expect(first.queryByText('No reviewed open edition is available for this work yet.')).toBeNull();
  expect(first.getByTestId('recovery-content').findAllByProps({ accessibilityRole: 'button' })).toHaveLength(0);
  fireEvent.press(first.getByRole('button', { name: 'Scan another book' }));
  expect(props.onScanAnother).toHaveBeenCalled();
  first.unmount();

  const error: EditionState = { status: 'error', result: null, message: 'Source unavailable' };
  const second = render(<EditionResolutionFlow {...props} state={error} />);
  expect(second.getByText("Couldn't check this book")).toBeTruthy();
  expect(second.getByRole('alert')).toHaveTextContent('Try again in a moment.');
  expect(second.queryByText('Source unavailable')).toBeNull();
  fireEvent.press(second.getByRole('button', { name: 'Try again' }));
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

  expect(view.getByText('No open edition available')).toBeTruthy();
  expect(view.getByText('Try another book or come back later.')).toBeTruthy();
  expect(view.queryByText('We found an authorized structured source, but could not safely convert it into an EPUB.')).toBeNull();
  expect(view.queryByRole('button', { name: 'Open in Books' })).toBeNull();
  expect(view.queryByRole('button', { name: 'Save to Files' })).toBeNull();
});
