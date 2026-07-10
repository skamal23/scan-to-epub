import { fireEvent, render } from '@testing-library/react-native';

import type { EditionResolutionResult } from '../../api/editions';
import { metadataScenarios } from '../../dev/metadataScenarios';
import type { EditionState } from '../../state/editionState';
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
    rightsStatement: 'Reviewed public-domain edition.', territory: 'US',
  },
  provenance: {
    catalogEntryId: 'standardebooks:pride', catalogReviewedAt: '2026-07-10',
    acquisitionUrl: 'https://standardebooks.org/book.epub?source=download',
    retrievedAt: '2026-07-10T18:00:00Z', originalSha256: 'a'.repeat(64), finalSha256: 'a'.repeat(64),
    transformation: 'unchanged', epubcheckVersion: '5.3.0', epubcheckStatus: 'valid', epubcheckWarnings: [],
  },
};

const props = {
  candidate: metadataScenarios.one[0],
  onBack: jest.fn(),
  onRetry: jest.fn(),
  onScanAnother: jest.fn(),
};

test('searching state preserves the confirmed physical edition', () => {
  const state: EditionState = { status: 'searching', result: null, message: null };
  const view = render(<EditionResolutionFlow {...props} state={state} />);

  expect(view.getByText('Work confirmed')).toBeTruthy();
  expect(view.getByText('Checking reviewed open editions…')).toBeTruthy();
  expect(view.getByText('Your physical edition')).toBeTruthy();
  expect(view.getByText('Penguin Classics, 2003')).toBeTruthy();
});

test('ready state shows verified digital edition and auditable rights details', () => {
  const state: EditionState = { status: 'resolved', result: ready, message: null };
  const view = render(<EditionResolutionFlow {...props} state={state} />);

  expect(view.getByText('Verified open edition')).toBeTruthy();
  expect(view.getByText('Standard Ebooks')).toBeTruthy();
  expect(view.getByText(/may differ from your physical copy/i)).toBeTruthy();
  expect(view.getByRole('button', { name: 'Open in Books — available next phase' })).toBeDisabled();
  fireEvent.press(view.getByRole('button', { name: 'Why this edition is available' }));
  expect(view.getByText('CC0 1.0 Universal')).toBeTruthy();
  expect(view.getByText('United States')).toBeTruthy();
  expect(view.getByText('EPUBCheck 5.3.0 · Valid')).toBeTruthy();
  expect(view.getByText(`SHA-256 ${'a'.repeat(12)}…`)).toBeTruthy();
});

test('unavailable and error states stay honest and recoverable', () => {
  const unavailable: EditionState = {
    status: 'resolved', message: null,
    result: { status: 'unavailable', reason: 'No reviewed open edition is available for this work yet.', physicalEdition: null, digitalEdition: null, source: null, rights: null, provenance: null },
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
