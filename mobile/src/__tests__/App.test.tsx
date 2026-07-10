import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Keyboard } from 'react-native';

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

import App from '../../App';
import type { BackendClient } from '../api/health';
import type {
  MetadataCandidate,
  MetadataClient,
  MetadataSearchResult,
} from '../api/metadata';

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

describe('<App />', () => {
  test('checks backend connectivity and enters the scanner shell', async () => {
    const view = render(
      <App client={healthyClient()} showScenarioLauncher={false} />,
    );

    expect(view.getByText('Checking backend…')).toBeTruthy();
    await waitFor(() => expect(view.getByText('Backend connected')).toBeTruthy());

    fireEvent.press(view.getByRole('button', { name: 'Open scanner' }));
    expect(view.getByText('Scan the ISBN barcode')).toBeTruthy();
    expect(view.getByLabelText('ISBN scan guide')).toBeTruthy();
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

    await waitFor(() => expect(view.getByText('Backend unavailable')).toBeTruthy());
    fireEvent.press(view.getByRole('button', { name: 'Retry connection' }));
    await waitFor(() => expect(view.getByText('Backend connected')).toBeTruthy());
    expect(client.checkHealth).toHaveBeenCalledTimes(2);
  });

  test('offers deterministic scenarios only in development builds', async () => {
    const hidden = render(
      <App client={healthyClient()} showScenarioLauncher={false} />,
    );
    await waitFor(() => expect(hidden.getByText('Backend connected')).toBeTruthy());
    expect(hidden.queryByText('Test scenarios')).toBeNull();
    hidden.unmount();

    const visible = render(
      <App client={healthyClient()} showScenarioLauncher={true} />,
    );
    await waitFor(() => expect(visible.getByText('Backend connected')).toBeTruthy());
    fireEvent.press(visible.getByRole('button', { name: 'Test scenarios' }));
    expect(visible.getByText('Scenario launcher')).toBeTruthy();

    fireEvent.press(visible.getByRole('button', { name: 'Offline' }));
    expect(visible.getByText('Backend unavailable')).toBeTruthy();
  });

  test('opens deterministic metadata scenarios without calling a provider', async () => {
    const metadata: MetadataClient = { search: jest.fn() };
    const view = render(
      <App client={healthyClient()} metadataClient={metadata} showScenarioLauncher />,
    );
    await waitFor(() => expect(view.getByText('Backend connected')).toBeTruthy());
    fireEvent.press(view.getByRole('button', { name: 'Test scenarios' }));
    fireEvent.press(view.getByRole('button', { name: 'Ambiguous books' }));

    expect(view.getByText('Is this the right book?')).toBeTruthy();
    expect(view.getByText('2 possible matches')).toBeTruthy();
    expect(metadata.search).not.toHaveBeenCalled();
  });

  test('lets the deterministic search-error scenario recover through the real retry path', async () => {
    const metadata = metadataClient({ candidates: [prideCandidate], providerFailures: [] });
    const view = render(
      <App client={healthyClient()} metadataClient={metadata} showScenarioLauncher />,
    );
    await waitFor(() => expect(view.getByText('Backend connected')).toBeTruthy());
    fireEvent.press(view.getByRole('button', { name: 'Test scenarios' }));
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

  test('searches by ISBN and confirms the work without claiming an edition match', async () => {
    const dismissKeyboard = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => undefined);
    const metadata = metadataClient({ candidates: [prideCandidate], providerFailures: [] });
    const view = render(
      <App
        client={healthyClient()}
        metadataClient={metadata}
        showScenarioLauncher={false}
      />,
    );
    await waitFor(() => expect(view.getByText('Backend connected')).toBeTruthy());

    fireEvent.press(view.getByRole('button', { name: 'Open scanner' }));
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
    expect(view.getByText('Work confirmed')).toBeTruthy();
    expect(view.getByText('Your physical edition')).toBeTruthy();
    expect(view.getByText('Penguin Classics, 2003')).toBeTruthy();
    expect(view.getByText(/open digital edition may differ/i)).toBeTruthy();
    dismissKeyboard.mockRestore();
  });

  test('shows an honest empty result and lets the user edit the search', async () => {
    const view = render(
      <App
        client={healthyClient()}
        metadataClient={metadataClient({ candidates: [], providerFailures: [] })}
        showScenarioLauncher={false}
      />,
    );
    await waitFor(() => expect(view.getByText('Backend connected')).toBeTruthy());
    fireEvent.press(view.getByRole('button', { name: 'Open scanner' }));
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
    await waitFor(() => expect(view.getByText('Backend connected')).toBeTruthy());
    fireEvent.press(view.getByRole('button', { name: 'Open scanner' }));
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
    await waitFor(() => expect(view.getByText('Backend connected')).toBeTruthy());
    fireEvent.press(view.getByRole('button', { name: 'Open scanner' }));
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
    await waitFor(() => expect(view.getByText('Backend connected')).toBeTruthy());
    fireEvent.press(view.getByRole('button', { name: 'Open scanner' }));
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
    await waitFor(() => expect(view.getByText('Backend connected')).toBeTruthy());
    fireEvent.press(view.getByRole('button', { name: 'Open scanner' }));
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
    await waitFor(() => expect(view.getByText('Backend connected')).toBeTruthy());
    fireEvent.press(view.getByRole('button', { name: 'Test scenarios' }));
    fireEvent.press(view.getByRole('button', { name: 'Repeated ISBN' }));

    expect(view.getByText('ISBN captured.')).toBeTruthy();
    await waitFor(() => expect(view.getByText('Is this the right book?')).toBeTruthy());
    expect(metadata.search).toHaveBeenCalledWith(
      { isbn: '9780141439518' },
      expect.anything(),
    );
  });
});
