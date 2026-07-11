import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, Keyboard, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

jest.mock('expo-camera', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    CameraView: (props: object) => React.createElement(View, { ...props, testID: 'camera-view' }),
    useCameraPermissions: () => [
      { granted: true, status: 'granted', canAskAgain: true },
      jest.fn(),
      jest.fn(),
    ],
  };
});

jest.mock('expo-haptics', () => ({
  NotificationFeedbackType: { Success: 'success' },
  notificationAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../ui/Entrance', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    Entrance: ({ children }: { children: React.ReactNode }) => React.createElement(
      View,
      { testID: 'launch-entrance' },
      children,
    ),
  };
});

import App from '../../App';
import type { BackendClient, HealthResponse } from '../api/health';
import type {
  MetadataCandidate,
  MetadataClient,
  MetadataSearchResult,
} from '../api/metadata';
import type { EditionClient } from '../api/editions';
import type { EpubDeliveryClient } from '../api/epubDelivery';
import {
  generatedEditionScenario,
  generatedPdfEditionScenario,
  generatedPlainTextEditionScenario,
  pdfConversionRefusalScenario,
  readyEditionScenario,
} from '../dev/editionScenarios';
import { useReducedMotionStatus } from '../ui/useReducedMotion';
import { colors } from '../ui/theme';

function MotionStatusProbe() {
  const { isReady, reducedMotion } = useReducedMotionStatus();

  if (!isReady) return <Text>motion-unknown</Text>;
  return <Text>{reducedMotion ? 'motion-reduced' : 'motion-full'}</Text>;
}

const healthyClient = (): BackendClient => ({
  checkHealth: jest.fn().mockResolvedValue({
    status: 'ok',
    service: 'book-backend',
    environment: 'test',
    fixtureMode: true,
    version: '0.1.0',
  }),
});

const prideCandidate: MetadataCandidate = {
  candidateId: 'pride',
  confidence: 'high',
  matchReasons: ['Exact ISBN match'],
  work: {
    title: 'Pride and Prejudice',
    authors: ['Jane Austen'],
    firstPublishedYear: 1813,
    language: 'en',
    sourceIds: { open_library: 'OL66554W' },
  },
  edition: {
    title: 'Pride and Prejudice',
    publisher: 'Penguin Classics',
    publishedDate: '2003',
    isbn10: '0141439513',
    isbn13: '9780141439518',
    coverUrl: 'https://covers.openlibrary.org/b/isbn/9780141439518-L.jpg',
    sourceIds: { open_library: 'OL7353617M' },
  },
  sources: [],
};

const metadataClient = (
  result: Omit<MetadataSearchResult, 'observedIsbn'> & { observedIsbn?: string | null },
): MetadataClient => ({
  search: jest.fn().mockResolvedValue({ observedIsbn: null, ...result }),
});

async function settleLaunch() {
  await act(async () => {
    await Promise.resolve();
  });
}

async function waitForHealthCheck(client: BackendClient, times = 1) {
  await waitFor(() => expect(client.checkHealth).toHaveBeenCalledTimes(times));
  await settleLaunch();
}

function openScenariosFromScanner(view: ReturnType<typeof render>) {
  fireEvent.press(view.getByRole('button', { name: 'Back' }));
  expect(view.getByText('Book to EPUB')).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: 'Test scenarios' }));
}

describe('<App />', () => {
  beforeEach(() => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation(
      (() => ({ remove: jest.fn() })) as never,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('keeps the root Reduce Motion observer current across navigation', async () => {
    const listeners = new Set<(enabled: boolean) => void>();
    const isReduceMotionEnabled = jest.mocked(AccessibilityInfo.isReduceMotionEnabled);
    const addEventListener = jest.mocked(AccessibilityInfo.addEventListener);
    addEventListener.mockImplementation(
      ((eventName: string, listener: (enabled: boolean) => void) => {
        if (eventName === 'reduceMotionChanged') {
          listeners.add(listener);
          return { remove: () => listeners.delete(listener) };
        }

        return { remove: jest.fn() };
      }) as never,
    );
    const app = render(<App client={healthyClient()} showScenarioLauncher={false} />);
    let screen: ReturnType<typeof render> | undefined;

    try {
      await settleLaunch();
      expect(listeners.size).toBeGreaterThan(0);

      expect(app.getByText('Scan a cover or ISBN')).toBeTruthy();

      act(() => {
        listeners.forEach((listener) => listener(true));
      });
      isReduceMotionEnabled.mockResolvedValue(true);
      screen = render(<MotionStatusProbe />);

      expect(screen.getByText('motion-reduced')).toBeTruthy();
    } finally {
      screen?.unmount();
      app.unmount();
    }
  });

  test('uses the editorial canvas token for the fallback home root', async () => {
    const view = render(<App client={healthyClient()} showScenarioLauncher={false} />);

    try {
      await settleLaunch();
      fireEvent.press(view.getByRole('button', { name: 'Back' }));
      const launchRoot = view.UNSAFE_getByType(SafeAreaView);

      expect(StyleSheet.flatten(launchRoot.props.style).backgroundColor).toBe(colors.canvas);
    } finally {
      view.unmount();
    }
  });

  test('opens directly to the scanner shell and reaches the fallback home through Back', async () => {
    const client = healthyClient();
    const view = render(
      <App client={client} showScenarioLauncher={false} />,
    );

    expect(view.getByText('Scan a cover or ISBN')).toBeTruthy();
    expect(view.getByLabelText('Book scan guide')).toBeTruthy();
    expect(view.queryByText('Book to EPUB')).toBeNull();

    await waitForHealthCheck(client);
    expect(view.getByText('Scan a cover or ISBN')).toBeTruthy();

    fireEvent.press(view.getByRole('button', { name: 'Back' }));
    expect(view.getByText('Scan a book to get started.')).toBeTruthy();
    expect(view.queryByText('RIGHTS-AWARE READING')).toBeNull();
    expect(view.queryByText('Identify a physical book and find a verified open edition.')).toBeNull();
    expect(view.queryByText('Backend connected')).toBeNull();
    expect(view.getByRole('button', { name: 'Open scanner' })).toBeTruthy();
  });

  test('keeps the scanner visible when health succeeds after entry', async () => {
    let resolveHealth!: (response: HealthResponse) => void;
    const client: BackendClient = {
      checkHealth: jest.fn(() => new Promise<HealthResponse>((resolve) => {
        resolveHealth = resolve;
      })),
    };
    const view = render(<App client={client} showScenarioLauncher={false} />);

    expect(view.getByText('Scan a cover or ISBN')).toBeTruthy();
    await waitFor(() => expect(client.checkHealth).toHaveBeenCalledTimes(1));

    await act(async () => {
      resolveHealth({
        status: 'ok',
        service: 'book-backend',
        environment: 'test',
        fixtureMode: true,
        version: '0.1.0',
      });
      await Promise.resolve();
    });

    expect(view.getByText('Scan a cover or ISBN')).toBeTruthy();
    expect(view.queryByText('Book to EPUB')).toBeNull();
  });

  test('routes an offline fixture to fallback and ignores an earlier health check', async () => {
    let resolveHealth!: (response: HealthResponse) => void;
    const client: BackendClient = {
      checkHealth: jest.fn(() => new Promise<HealthResponse>((resolve) => {
        resolveHealth = resolve;
      })),
    };
    const view = render(<App client={client} showScenarioLauncher />);

    await waitFor(() => expect(client.checkHealth).toHaveBeenCalledTimes(1));
    openScenariosFromScanner(view);
    fireEvent.press(view.getByRole('button', { name: 'Offline' }));
    expect(view.getByText('Backend unavailable')).toBeTruthy();

    await act(async () => {
      resolveHealth({
        status: 'ok',
        service: 'book-backend',
        environment: 'test',
        fixtureMode: true,
        version: '0.1.0',
      });
      await Promise.resolve();
    });

    expect(view.getByText('Backend unavailable')).toBeTruthy();
    expect(view.getByRole('button', { name: 'Retry connection' })).toBeTruthy();
  });

  test('routes a timeout fixture to the fallback recovery state', async () => {
    const view = render(<App client={healthyClient()} showScenarioLauncher />);

    await settleLaunch();
    openScenariosFromScanner(view);
    fireEvent.press(view.getByRole('button', { name: 'Timeout' }));

    expect(view.getByText('Connection timed out')).toBeTruthy();
    expect(view.getByRole('button', { name: 'Retry connection' })).toBeTruthy();
  });

  test('does not animate the fallback launch content', async () => {
    const client = healthyClient();
    const view = render(<App client={client} showScenarioLauncher={false} />);

    try {
      await waitForHealthCheck(client);
      fireEvent.press(view.getByRole('button', { name: 'Back' }));
      expect(view.queryByTestId('launch-entrance')).toBeNull();
    } finally {
      view.unmount();
    }
  });

  test('shows an unavailable state and retries successfully', async () => {
    const client: BackendClient = {
      checkHealth: jest
        .fn()
        .mockRejectedValueOnce(new Error('Backend unavailable'))
        .mockResolvedValueOnce({
          status: 'ok',
          service: 'book-backend',
          environment: 'test',
          fixtureMode: true,
          version: '0.1.0',
        }),
    };
    const view = render(<App client={client} showScenarioLauncher={false} />);

    await waitForHealthCheck(client);
    expect(view.getByText('Scan a cover or ISBN')).toBeTruthy();
    fireEvent.press(view.getByRole('button', { name: 'Back' }));
    expect(view.getByText('Backend unavailable')).toBeTruthy();
    fireEvent.press(view.getByRole('button', { name: 'Retry connection' }));
    await waitForHealthCheck(client, 2);
    expect(view.queryByText('Backend connected')).toBeNull();
    expect(view.queryByRole('button', { name: 'Retry connection' })).toBeNull();
  });

  test('offers deterministic scenarios only in development builds', async () => {
    const hidden = render(
      <App client={healthyClient()} showScenarioLauncher={false} />,
    );
    await settleLaunch();
    fireEvent.press(hidden.getByRole('button', { name: 'Back' }));
    expect(hidden.queryByText('Test scenarios')).toBeNull();
    hidden.unmount();

    const visible = render(
      <App client={healthyClient()} showScenarioLauncher={true} />,
    );
    await settleLaunch();
    openScenariosFromScanner(visible);
    expect(visible.getByText('Scenario launcher')).toBeTruthy();

    fireEvent.press(visible.getByRole('button', { name: 'Offline' }));
    expect(visible.getByText('Backend unavailable')).toBeTruthy();
  });

  test('opens deterministic metadata scenarios without calling a provider', async () => {
    const metadata: MetadataClient = { search: jest.fn() };
    const view = render(
      <App client={healthyClient()} metadataClient={metadata} showScenarioLauncher />,
    );
    await settleLaunch();
    openScenariosFromScanner(view);
    fireEvent.press(view.getByRole('button', { name: 'Ambiguous books' }));

    expect(view.getByText('Is this the right book?')).toBeTruthy();
    expect(view.getByText('2 possible matches')).toBeTruthy();
    expect(metadata.search).not.toHaveBeenCalled();
  });

  test('recognizes a deterministic cover and explains its confidence before confirmation', async () => {
    const view = render(
      <App client={healthyClient()} showScenarioLauncher />,
    );
    await settleLaunch();
    openScenariosFromScanner(view);
    fireEvent.press(view.getByRole('button', { name: 'Cover: strong match' }));
    fireEvent.press(view.getByRole('button', { name: 'Capture cover or detected ISBN' }));

    await waitFor(() => expect(view.getByText('Is this the right book?')).toBeTruthy());
    expect(view.getByText('Strong cover match—please confirm the work.')).toBeTruthy();
    expect(view.getByRole('button', { name: 'Scan again' })).toBeTruthy();
  });

  test('lets the deterministic search-error scenario recover through the real retry path', async () => {
    const metadata = metadataClient({ candidates: [prideCandidate], providerFailures: [] });
    const view = render(
      <App client={healthyClient()} metadataClient={metadata} showScenarioLauncher />,
    );
    await settleLaunch();
    openScenariosFromScanner(view);
    fireEvent.press(view.getByRole('button', { name: 'Search error' }));
    expect(view.getByText('Search unavailable')).toBeTruthy();

    fireEvent.press(view.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(view.getByText('Is this the right book?')).toBeTruthy());
    expect(metadata.search).toHaveBeenCalledWith(
      {
        title: 'Pride and Prejudice',
        author: 'Jane Austen',
      },
      expect.anything(),
    );
  });

  test('searches by ISBN and resolves a separate verified open edition', async () => {
    const dismissKeyboard = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => undefined);
    const metadata = metadataClient({ candidates: [prideCandidate], providerFailures: [] });
    const editions: EditionClient = { resolve: jest.fn().mockResolvedValue(readyEditionScenario) };
    const view = render(
      <App
        client={healthyClient()}
        metadataClient={metadata}
        editionClient={editions}
        showScenarioLauncher={false}
      />,
    );
    await settleLaunch();

    fireEvent.press(view.getByRole('button', { name: 'Search manually' }));
    fireEvent.changeText(view.getByLabelText('ISBN'), '9780141439518');
    fireEvent.press(view.getByRole('button', { name: 'Find book' }));

    await waitFor(() => expect(view.getByText('Is this the right book?')).toBeTruthy());
    expect(dismissKeyboard).toHaveBeenCalled();
    expect(metadata.search).toHaveBeenCalledWith(
      { isbn: '9780141439518' },
      expect.anything(),
    );
    fireEvent.press(view.getByRole('button', { name: 'Choose Pride and Prejudice by Jane Austen' }));
    await waitFor(() => expect(view.getByText('Verified open edition')).toBeTruthy());
    expect(view.getByText('Work confirmed')).toBeTruthy();
    expect(view.getByText('Your physical edition')).toBeTruthy();
    expect(view.getByText('Penguin Classics, 2003')).toBeTruthy();
    expect(view.getByText(/open digital edition may differ/i)).toBeTruthy();
    expect(editions.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        workTitle: 'Pride and Prejudice',
        physicalIsbn13: '9780141439518',
        territory: 'US',
      }),
      expect.anything(),
    );
    dismissKeyboard.mockRestore();
  });

  test('opens deterministic verified and unavailable edition scenarios', async () => {
    const editions: EditionClient = { resolve: jest.fn().mockResolvedValue(readyEditionScenario) };
    const view = render(<App client={healthyClient()} editionClient={editions} showScenarioLauncher />);
    await settleLaunch();
    openScenariosFromScanner(view);
    fireEvent.press(view.getByRole('button', { name: 'Verified open edition' }));
    await waitFor(() => expect(view.getByText('Verified open edition')).toBeTruthy());
    expect(editions.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ workTitle: 'Pride and Prejudice' }),
      expect.anything(),
    );
    fireEvent.press(view.getByRole('button', { name: 'Scan another book' }));
    fireEvent.press(view.getByRole('button', { name: 'Back' }));
    fireEvent.press(view.getByRole('button', { name: 'Test scenarios' }));
    fireEvent.press(view.getByRole('button', { name: 'Open edition unavailable' }));
    expect(view.getByText('Book identified, open edition unavailable')).toBeTruthy();
  });

  test('opens a deterministic open-license fallback-details scenario', async () => {
    const view = render(<App client={healthyClient()} showScenarioLauncher />);
    await settleLaunch();
    openScenariosFromScanner(view);
    fireEvent.press(view.getByRole('button', { name: 'Open-license fallback details' }));

    expect(view.getByText('Checked a later approved path after an earlier option could not be delivered.')).toBeTruthy();
    expect(view.getByText('No reusable source cover')).toBeTruthy();
    fireEvent.press(view.getByRole('button', { name: 'Why this edition is available' }));
    expect(view.getByText('CC BY 4.0')).toBeTruthy();
  });

  test('routes the generated test EPUB scenario through the normal resolver flow', async () => {
    const editions: EditionClient = {
      resolve: jest.fn().mockResolvedValue(generatedEditionScenario),
    };
    const view = render(
      <App client={healthyClient()} editionClient={editions} showScenarioLauncher />,
    );
    await settleLaunch();
    openScenariosFromScanner(view);
    fireEvent.press(view.getByRole('button', { name: 'Generated test EPUB' }));

    await waitFor(() => expect(view.getByText('Generated open edition')).toBeTruthy());
    expect(editions.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        candidateId: 'fixture:generated-html',
        workTitle: 'Structured Open Text',
      }),
      expect.anything(),
    );
  });

  test('routes the generated plain-text EPUB scenario through the normal resolver flow', async () => {
    const editions: EditionClient = {
      resolve: jest.fn().mockResolvedValue(generatedPlainTextEditionScenario),
    };
    const view = render(
      <App client={healthyClient()} editionClient={editions} showScenarioLauncher />,
    );
    await settleLaunch();
    openScenariosFromScanner(view);
    fireEvent.press(view.getByRole('button', { name: 'Generated plain-text EPUB' }));

    await waitFor(() => expect(view.getByText('Generated open edition')).toBeTruthy());
    expect(editions.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        candidateId: 'fixture:generated-plain-text',
        workTitle: 'Structured Plain Text',
      }),
      expect.anything(),
    );
  });

  test('routes the guarded PDF scenario through the normal resolver flow', async () => {
    const editions: EditionClient = {
      resolve: jest.fn().mockResolvedValue(generatedPdfEditionScenario),
    };
    const view = render(
      <App client={healthyClient()} editionClient={editions} showScenarioLauncher />,
    );
    await settleLaunch();
    openScenariosFromScanner(view);
    fireEvent.press(view.getByRole('button', { name: 'PDF test EPUB' }));

    await waitFor(() => expect(view.getByText('Generated open edition')).toBeTruthy());
    expect(editions.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        candidateId: 'fixture:generated-pdf',
        workTitle: 'Authorized PDF Source',
      }),
      expect.anything(),
    );
  });

  test('shows a guarded PDF refusal without offering an EPUB export', async () => {
    const editions: EditionClient = {
      resolve: jest.fn().mockResolvedValue(pdfConversionRefusalScenario),
    };
    const view = render(
      <App client={healthyClient()} editionClient={editions} showScenarioLauncher />,
    );
    await settleLaunch();
    openScenariosFromScanner(view);
    fireEvent.press(view.getByRole('button', { name: 'PDF conversion refused' }));

    await waitFor(() => expect(view.getByText('Book identified, open edition unavailable')).toBeTruthy());
    expect(editions.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        candidateId: 'fixture:pdf-refused',
        workTitle: 'PDF Conversion Refusal',
      }),
      expect.anything(),
    );
    expect(view.getByText(
      'We found an authorized PDF, but could not safely convert its layout into an EPUB.',
    )).toBeTruthy();
    expect(view.queryByRole('button', { name: 'Open in Books' })).toBeNull();
    expect(view.queryByRole('button', { name: 'Save to Files' })).toBeNull();
  });

  test('downloads a verified EPUB, opens the native handoff, and cleans the local copy before another scan', async () => {
    const start = jest.fn().mockResolvedValue({
      uri: 'file:///cache/Pride-and-Prejudice-Jane-Austen.epub',
      filename: 'Pride-and-Prejudice-Jane-Austen.epub',
    });
    const delivery: EpubDeliveryClient = {
      createDownload: jest.fn(() => ({ start, cancel: jest.fn().mockResolvedValue(undefined) })),
      shareEpub: jest.fn().mockResolvedValue(undefined),
      cleanup: jest.fn().mockResolvedValue(undefined),
    };
    const editions: EditionClient = { resolve: jest.fn().mockResolvedValue(readyEditionScenario) };
    const view = render(
      <App
        client={healthyClient()}
        editionClient={editions}
        epubDeliveryClient={delivery}
        showScenarioLauncher
      />,
    );
    await settleLaunch();
    openScenariosFromScanner(view);
    fireEvent.press(view.getByRole('button', { name: 'Verified open edition' }));
    await waitFor(() => expect(view.getByRole('button', { name: 'Open in Books' })).toBeTruthy());

    fireEvent.press(view.getByRole('button', { name: 'Open in Books' }));
    await waitFor(() => expect(start).toHaveBeenCalled());
    await waitFor(() => expect(delivery.shareEpub).toHaveBeenCalledWith('file:///cache/Pride-and-Prejudice-Jane-Austen.epub'));

    fireEvent.press(view.getByRole('button', { name: 'Scan another book' }));
    await waitFor(() => expect(delivery.cleanup).toHaveBeenCalledWith('file:///cache/Pride-and-Prejudice-Jane-Austen.epub'));
  });

  test('retries a deterministic source outage without rescanning', async () => {
    const editions: EditionClient = { resolve: jest.fn().mockResolvedValue(readyEditionScenario) };
    const view = render(
      <App client={healthyClient()} editionClient={editions} showScenarioLauncher />,
    );
    await settleLaunch();
    openScenariosFromScanner(view);
    fireEvent.press(view.getByRole('button', { name: 'Edition source offline' }));
    expect(view.getByText('Open-edition check unavailable')).toBeTruthy();

    fireEvent.press(view.getByRole('button', { name: 'Try source check again' }));
    await waitFor(() => expect(view.getByText('Verified open edition')).toBeTruthy());
    expect(editions.resolve).toHaveBeenCalledTimes(1);
  });

  test('shows an honest empty result and lets the user edit the search', async () => {
    const view = render(
      <App
        client={healthyClient()}
        metadataClient={metadataClient({ candidates: [], providerFailures: [] })}
        showScenarioLauncher={false}
      />,
    );
    await settleLaunch();
    fireEvent.press(view.getByRole('button', { name: 'Search manually' }));
    fireEvent.changeText(view.getByLabelText('Book title'), 'Missing book');
    fireEvent.press(view.getByRole('button', { name: 'Find book' }));

    await waitFor(() => expect(view.getByText('No books found')).toBeTruthy());
    fireEvent.press(view.getByRole('button', { name: 'Edit search' }));
    expect(view.getByLabelText('Book title')).toHaveProp('value', 'Missing book');
  });

  test('keeps ambiguous candidates unselected and supports none of these', async () => {
    const second = {
      ...prideCandidate,
      candidateId: 'second',
      confidence: 'medium' as const,
      work: { ...prideCandidate.work, title: 'Pride and Prejudice and Zombies' },
      edition: { ...prideCandidate.edition, title: 'Pride and Prejudice and Zombies' },
    };
    const view = render(
      <App
        client={healthyClient()}
        metadataClient={metadataClient({ candidates: [prideCandidate, second], providerFailures: [] })}
        showScenarioLauncher={false}
      />,
    );
    await settleLaunch();
    fireEvent.press(view.getByRole('button', { name: 'Search manually' }));
    fireEvent.changeText(view.getByLabelText('Book title'), 'Pride and Prejudice');
    fireEvent.press(view.getByRole('button', { name: 'Find book' }));

    await waitFor(() => expect(view.getByText('2 possible matches')).toBeTruthy());
    fireEvent.press(view.getByRole('button', { name: 'None of these' }));
    expect(view.getByLabelText('Book title')).toHaveProp('value', 'Pride and Prejudice');
  });

  test('retries the last query after a catalog failure', async () => {
    const metadata: MetadataClient = {
      search: jest
        .fn()
        .mockRejectedValueOnce(new Error('Book search is temporarily unavailable'))
        .mockResolvedValueOnce({ candidates: [prideCandidate], providerFailures: [] }),
    };
    const view = render(
      <App client={healthyClient()} metadataClient={metadata} showScenarioLauncher={false} />,
    );
    await settleLaunch();
    fireEvent.press(view.getByRole('button', { name: 'Search manually' }));
    fireEvent.changeText(view.getByLabelText('ISBN'), '9780141439518');
    fireEvent.press(view.getByRole('button', { name: 'Find book' }));

    await waitFor(() => expect(view.getByText('Search unavailable')).toBeTruthy());
    fireEvent.press(view.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(view.getByText('Is this the right book?')).toBeTruthy());
    expect(metadata.search).toHaveBeenCalledTimes(2);
  });

  test('ignores a late response after the user cancels a search', async () => {
    let resolveSearch!: (result: MetadataSearchResult) => void;
    let requestSignal: AbortSignal | undefined;
    const pending = new Promise<MetadataSearchResult>((resolve) => {
      resolveSearch = resolve;
    });
    const metadata: MetadataClient = {
      search: jest.fn((_query, signal) => {
        requestSignal = signal;
        return pending;
      }),
    };
    const view = render(
      <App client={healthyClient()} metadataClient={metadata} showScenarioLauncher={false} />,
    );
    await settleLaunch();
    fireEvent.press(view.getByRole('button', { name: 'Search manually' }));
    fireEvent.changeText(view.getByLabelText('Book title'), 'Pride and Prejudice');
    fireEvent.press(view.getByRole('button', { name: 'Find book' }));
    expect(view.getByText('Searching book records…')).toBeTruthy();
    fireEvent.press(view.getByRole('button', { name: 'Cancel search' }));
    expect(requestSignal?.aborted).toBe(true);
    expect(view.getByLabelText('Book title')).toBeTruthy();

    resolveSearch({ observedIsbn: null, candidates: [prideCandidate], providerFailures: [] });
    await Promise.resolve();
    expect(view.queryByText('Is this the right book?')).toBeNull();
    expect(view.getByLabelText('Book title')).toBeTruthy();
  });

  test('replaces a failed remote cover with an explicit fallback', async () => {
    const view = render(
      <App
        client={healthyClient()}
        metadataClient={metadataClient({ candidates: [prideCandidate], providerFailures: [] })}
        showScenarioLauncher={false}
      />,
    );
    await settleLaunch();
    fireEvent.press(view.getByRole('button', { name: 'Search manually' }));
    fireEvent.changeText(view.getByLabelText('ISBN'), '9780141439518');
    fireEvent.press(view.getByRole('button', { name: 'Find book' }));
    await waitFor(() => expect(view.getByText('Is this the right book?')).toBeTruthy());

    fireEvent(view.getByTestId('cover-pride'), 'error');
    expect(view.getByText('No cover')).toBeTruthy();
  });

  test('routes a repeated fixture ISBN through the production metadata flow', async () => {
    const metadata = metadataClient({
      observedIsbn: '9780141439518',
      candidates: [prideCandidate],
      providerFailures: [],
    });
    const view = render(
      <App client={healthyClient()} metadataClient={metadata} showScenarioLauncher />,
    );
    await settleLaunch();
    openScenariosFromScanner(view);
    fireEvent.press(view.getByRole('button', { name: 'Repeated ISBN' }));

    expect(view.getByText('ISBN captured.')).toBeTruthy();
    await waitFor(() => expect(view.getByText('Is this the right book?')).toBeTruthy());
    expect(metadata.search).toHaveBeenCalledWith(
      { isbn: '9780141439518' },
      expect.anything(),
    );
  });
});
