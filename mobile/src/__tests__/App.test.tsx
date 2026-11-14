import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import App from '../../App';
import { metadataScenarios } from '../dev/metadataScenarios';
import { readyEditionScenario, unavailableEditionScenario } from '../dev/editionScenarios';
import { defaultPreferences, type LibraryBook, type LibraryRepository } from '../library/types';

jest.mock('expo-font', () => ({
  useFonts: () => [true, null],
}));
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
jest.mock('@expo/vector-icons/Feather', () => () => null);
jest.mock('expo-haptics', () => ({ selectionAsync: async () => undefined }));
jest.mock('../library/repository', () => ({ libraryRepository: {} }));
let mockReaderAutoReady = true;
let mockReaderEvent: (
  event: { type: 'ready'; toc: [] } | { type: 'error'; message: string },
) => void;
jest.mock('../reader/ReaderSurface', () => ({
  ReaderSurface: ({ onEvent }: { onEvent: typeof mockReaderEvent }) => {
    const React = require('react');
    mockReaderEvent = onEvent;
    React.useEffect(() => {
      if (mockReaderAutoReady) onEvent({ type: 'ready', toc: [] });
    }, [onEvent]);
    return null;
  },
}));
jest.mock('../scanner/ScannerScreen', () => {
  const { Button } = require('react-native');
  return {
    ScannerScreen: ({ onManualSearch }: { onManualSearch(): void }) => (
      <Button title="Search manually" onPress={onManualSearch} />
    ),
  };
});
jest.mock('../api/coverRuntime', () => ({ createExpoCoverClient: () => ({}) }));
jest.mock('../api/epubDeliveryRuntime', () => ({
  createExpoEpubDeliveryClient: () => ({}),
}));
const book: LibraryBook = {
  id: 'book',
  title: 'Pride and Prejudice',
  authors: ['Jane Austen'],
  coverUri: null,
  fileUri: 'file:///book.epub',
  addedAt: '2026-11-13',
  openedAt: null,
  location: null,
  progress: 0,
  bookmarks: [],
};
function repository(): LibraryRepository {
  return {
    list: jest.fn().mockResolvedValue([]),
    importFile: jest.fn().mockResolvedValue(book),
    update: jest.fn().mockResolvedValue(book),
    remove: jest.fn().mockResolvedValue(undefined),
    preferences: jest.fn().mockResolvedValue(defaultPreferences),
    setPreferences: jest.fn().mockResolvedValue(undefined),
  };
}
beforeEach(() => {
  mockReaderAutoReady = true;
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
});
afterEach(() => jest.restoreAllMocks());
async function find(view: ReturnType<typeof render>) {
  fireEvent.press(await view.findByRole('button', { name: 'Scan your first book' }));
  fireEvent.press(view.getByText('Search manually'));
  fireEvent.changeText(view.getByLabelText('Book title or ISBN'), 'Pride and Prejudice');
  fireEvent.press(view.getByRole('button', { name: 'Find book' }));
  await view.findByText('Is this your book?');
}
test('confirmation saves the book before automatically opening the reader', async () => {
  const repo = repository(),
    resolve = jest.fn().mockResolvedValue(readyEditionScenario),
    cleanup = jest.fn().mockResolvedValue(undefined);
  let finishImport!: (book: LibraryBook) => void;
  jest.mocked(repo.importFile).mockReturnValue(
    new Promise((resolve) => {
      finishImport = resolve;
    }),
  );
  const view = render(
    <App
      repository={repo}
      metadataClient={{
        search: async () => ({
          candidates: metadataScenarios.one,
          observedIsbn: null,
          providerFailures: [],
        }),
      }}
      editionClient={{ resolve }}
      epubDeliveryClient={{
        createDownload: () => ({
          start: async () => ({
            uri: 'file:///cache.epub',
            filename: 'book.epub',
          }),
          cancel: async () => undefined,
        }),
        cleanup,
        shareEpub: async () => undefined,
      }}
    />,
  );
  await find(view);
  expect(resolve).not.toHaveBeenCalled();
  fireEvent.press(view.getByRole('button', { name: 'Yes, this is my book' }));
  await waitFor(() =>
    expect(repo.importFile).toHaveBeenCalledWith(
      'file:///cache.epub',
      expect.objectContaining({ title: book.title }),
    ),
  );
  expect(view.queryByRole('button', { name: 'Table of contents' })).toBeNull();
  await act(async () => finishImport(book));
  await view.findByRole('button', { name: 'Table of contents' });
  expect(view.queryByRole('button', { name: 'Save to library' })).toBeNull();
  expect(view.queryByRole('button', { name: 'Start reading' })).toBeNull();
  await waitFor(() => expect(cleanup).toHaveBeenCalledWith('file:///cache.epub'));
});
test('unavailable editions offer import and a way back without an empty reader', async () => {
  const view = render(
    <App
      repository={repository()}
      metadataClient={{
        search: async () => ({
          candidates: metadataScenarios.one,
          observedIsbn: null,
          providerFailures: [],
        }),
      }}
      editionClient={{ resolve: async () => unavailableEditionScenario }}
    />,
  );
  await find(view);
  fireEvent.press(view.getByRole('button', { name: 'Yes, this is my book' }));
  await view.findByText('No open edition available');
  expect(view.queryByRole('button', { name: 'Table of contents' })).toBeNull();
  fireEvent.press(view.getByRole('button', { name: 'Try another book' }));
  expect(view.getByLabelText('Book title or ISBN')).toBeTruthy();
});

function downloadFlow(
  repo: LibraryRepository,
  start: () => Promise<{ uri: string; filename: string }>,
) {
  const resolve = jest.fn().mockResolvedValue(readyEditionScenario);
  const cleanup = jest.fn().mockResolvedValue(undefined);
  const view = render(
    <App
      repository={repo}
      metadataClient={{
        search: async () => ({
          candidates: metadataScenarios.one,
          observedIsbn: null,
          providerFailures: [],
        }),
      }}
      editionClient={{ resolve }}
      epubDeliveryClient={{
        createDownload: () => ({ start, cancel: async () => undefined }),
        cleanup,
        shareEpub: async () => undefined,
      }}
    />,
  );
  return { view, resolve, cleanup };
}
test('cancelling an automatic download prevents a late result from saving or opening', async () => {
  let finish!: (value: { uri: string; filename: string }) => void;
  const start = jest.fn(
    () =>
      new Promise<{ uri: string; filename: string }>((resolve) => {
        finish = resolve;
      }),
  );
  const repo = repository();
  const { view, cleanup } = downloadFlow(repo, start);
  await find(view);
  fireEvent.press(view.getByRole('button', { name: 'Yes, this is my book' }));
  await waitFor(() => expect(start).toHaveBeenCalled());
  fireEvent.press(view.getByRole('button', { name: 'Cancel and go back' }));
  await act(async () => finish({ uri: 'file:///late.epub', filename: 'book.epub' }));
  expect(repo.importFile).not.toHaveBeenCalled();
  expect(view.getByLabelText('Book title or ISBN')).toBeTruthy();
  expect(view.queryByRole('button', { name: 'Table of contents' })).toBeNull();
  expect(cleanup).toHaveBeenCalledWith('file:///late.epub');
});
test('a failed automatic download retries and opens without another confirmation', async () => {
  const start = jest
    .fn()
    .mockRejectedValueOnce(new Error('Download interrupted'))
    .mockResolvedValue({ uri: 'file:///retry.epub', filename: 'book.epub' });
  const repo = repository();
  const { view, resolve } = downloadFlow(repo, start);
  await find(view);
  fireEvent.press(view.getByRole('button', { name: 'Yes, this is my book' }));
  await view.findByText('Download interrupted');
  expect(repo.importFile).not.toHaveBeenCalled();
  fireEvent.press(view.getByRole('button', { name: 'Try again' }));
  await view.findByRole('button', { name: 'Table of contents' });
  expect(resolve).toHaveBeenCalledTimes(1);
  expect(start).toHaveBeenCalledTimes(2);
  expect(repo.importFile).toHaveBeenCalledTimes(1);
});

test('holds the cover until the first page is prepared, then reveals the reader', async () => {
  mockReaderAutoReady = false;
  const { view } = downloadFlow(repository(), async () => ({
    uri: 'file:///book.epub',
    filename: 'book.epub',
  }));
  await find(view);
  fireEvent.press(view.getByRole('button', { name: 'Yes, this is my book' }));
  await view.findByTestId('reader-transition');
  expect(view.queryByRole('button', { name: 'Table of contents' })).toBeNull();
  act(() => mockReaderEvent({ type: 'ready', toc: [] }));
  await view.findByRole('button', { name: 'Table of contents' });
  expect(view.queryByTestId('reader-transition')).toBeNull();
});
test('a reader load error dismisses the cover so recovery remains accessible', async () => {
  mockReaderAutoReady = false;
  const { view } = downloadFlow(repository(), async () => ({
    uri: 'file:///book.epub',
    filename: 'book.epub',
  }));
  await find(view);
  fireEvent.press(view.getByRole('button', { name: 'Yes, this is my book' }));
  await view.findByTestId('reader-transition');
  act(() => mockReaderEvent({ type: 'error', message: 'This saved file could not be loaded.' }));
  await view.findByText('This saved file could not be loaded.');
  expect(view.queryByTestId('reader-transition')).toBeNull();
  expect(view.getAllByRole('button', { name: 'Back to library' }).length).toBeGreaterThan(0);
});
