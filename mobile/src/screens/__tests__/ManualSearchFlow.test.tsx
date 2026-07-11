import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import type { MetadataCandidate } from '../../api/metadata';
import type { SearchState } from '../../state/searchState';
import { colors } from '../../ui/theme';

type MockEntranceProps = {
  children: React.ReactNode;
};

const mockEntrance = jest.fn(({ children }: MockEntranceProps) => children);

jest.mock('../../ui/Entrance', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    Entrance: (props: MockEntranceProps) => React.createElement(
      View,
      { testID: 'entrance' },
      mockEntrance(props),
    ),
  };
});

import { ManualSearchFlow } from '../ManualSearchFlow';

const candidate: MetadataCandidate = {
  candidateId: 'pride',
  confidence: 'high',
  matchReasons: ['Exact ISBN match'],
  work: {
    title: 'Pride and Prejudice',
    authors: ['Jane Austen'],
    firstPublishedYear: 1813,
    language: 'en',
    sourceIds: {},
  },
  edition: {
    title: 'Pride and Prejudice',
    publisher: 'Penguin Classics',
    publishedDate: '2003',
    isbn10: '0141439513',
    isbn13: '9780141439518',
    coverUrl: null,
    sourceIds: {},
  },
  sources: [],
};

const callbacks = {
  onBack: jest.fn(),
  onCancel: jest.fn(),
  onConfirm: jest.fn(),
  onEdit: jest.fn(),
  onRetry: jest.fn(),
  onSearch: jest.fn(),
};

function candidatesState(overrides: Partial<SearchState> = {}): SearchState {
  return {
    status: 'candidates',
    candidates: [candidate],
    providerFailures: [],
    selected: null,
    message: null,
    ...overrides,
  };
}

function renderCandidates(state = candidatesState()) {
  return render(<ManualSearchFlow {...callbacks} state={state} />);
}

describe('<ManualSearchFlow />', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('keeps a fallback candidate one accessible choice without technical match copy', () => {
    const view = renderCandidates();
    const card = view.getByRole('button', { name: 'Choose Pride and Prejudice by Jane Austen' });

    expect(view.getByText('No cover')).toBeTruthy();
    expect(view.queryByText('Exact ISBN match')).toBeNull();
    fireEvent.press(card);
    expect(callbacks.onConfirm).toHaveBeenCalledWith(candidate);
  });

  test('uses the editorial title color without adding scale motion to the choice', () => {
    const view = renderCandidates();
    const card = view.getByRole('button', { name: 'Choose Pride and Prejudice by Jane Austen' });

    expect(StyleSheet.flatten(view.getByText('Pride and Prejudice').props.style).color).toBe(colors.ink);
    expect(StyleSheet.flatten(card.props.style).transform).toBeUndefined();
  });

  test('uses a minimal confirmation prompt and reserves the provider warning for recovery', () => {
    const defaultCandidates = renderCandidates();
    const view = renderCandidates(candidatesState({ providerFailures: ['Open Library'] }));

    try {
      expect(defaultCandidates.getByText('Is this your book?')).toBeTruthy();
      expect(defaultCandidates.queryByText('Some catalogs were unavailable. Results may be limited.')).toBeNull();
      expect(view.queryByText('1 possible match')).toBeNull();
      expect(view.getByText('Some catalogs were unavailable. Results may be limited.')).toBeTruthy();
    } finally {
      defaultCandidates.unmount();
      view.unmount();
    }
  });

  test('does not constrain a long candidate title to a single line', () => {
    const longTitle = 'The Extremely Long and Unexpectedly Detailed Book Title That Must Still Fit on a Small Screen';
    const view = renderCandidates(candidatesState({
      candidates: [{
        ...candidate,
        work: { ...candidate.work, title: longTitle },
        edition: { ...candidate.edition, title: longTitle },
      }],
    }));

    const title = view.getByText(longTitle);
    expect(title.props.numberOfLines).toBeUndefined();
    expect(title.props.ellipsizeMode).toBeUndefined();
  });

  test('keeps the candidate prompt static and uses entrances only for non-control content', () => {
    const form = render(
      <ManualSearchFlow
        {...callbacks}
        state={{ status: 'idle', candidates: [], providerFailures: [], selected: null, message: null }}
      />,
    );
    const defaultCandidates = renderCandidates();
    const recoveryCandidates = renderCandidates(candidatesState({ providerFailures: ['Open Library'] }));

    try {
      expect(defaultCandidates.getByText('Is this your book?')).toBeTruthy();
      expect(defaultCandidates.queryAllByTestId('entrance')).toHaveLength(0);

      for (const view of [form, recoveryCandidates]) {
        const entrances = view.getAllByTestId('entrance');
        expect(entrances).not.toHaveLength(0);
        for (const entrance of entrances) {
          expect(entrance.findAllByProps({ accessibilityRole: 'button' })).toHaveLength(0);
        }
      }
    } finally {
      form.unmount();
      defaultCandidates.unmount();
      recoveryCandidates.unmount();
    }
  });
});
