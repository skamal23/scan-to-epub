import { exportReducer, initialExportState } from '../exportState';


test('export state preserves a verified local EPUB through sharing and gives cancellation a safe recovery state', () => {
  const downloading = exportReducer(initialExportState, { type: 'downloadStarted', intent: 'books' });
  expect(downloading).toMatchObject({ status: 'downloading', intent: 'books', file: null });

  const progress = exportReducer(downloading, {
    type: 'progressed',
    progress: { receivedBytes: 50, expectedBytes: 100, fraction: 0.5 },
  });
  expect(progress.progress?.fraction).toBe(0.5);

  const downloaded = exportReducer(progress, {
    type: 'downloaded',
    file: { uri: 'file:///cache/Pride-and-Prejudice-Jane-Austen.epub', filename: 'Pride-and-Prejudice-Jane-Austen.epub' },
  });
  const sharing = exportReducer(downloaded, { type: 'sharing' });
  const returned = exportReducer(sharing, { type: 'shareFinished' });
  expect(returned).toMatchObject({ status: 'ready', file: downloaded.file, message: 'EPUB is ready to share again.' });

  const cancelled = exportReducer(initialExportState, {
    type: 'failed',
    code: 'cancelled',
    message: 'EPUB download was cancelled',
  });
  expect(cancelled).toMatchObject({ status: 'error', file: null, code: 'cancelled' });
  expect(exportReducer(returned, { type: 'reset' })).toEqual(initialExportState);
});
