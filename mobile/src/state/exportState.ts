import type {
  DownloadedEpub,
  EpubDeliveryErrorCode,
  EpubDownloadProgress,
} from '../api/epubDelivery';


export type ExportIntent = 'books' | 'files';

export type ExportState = {
  status: 'idle' | 'downloading' | 'ready' | 'sharing' | 'error';
  intent: ExportIntent | null;
  file: DownloadedEpub | null;
  progress: EpubDownloadProgress | null;
  message: string | null;
  code: EpubDeliveryErrorCode | null;
};

export type ExportAction =
  | { type: 'downloadStarted'; intent: ExportIntent }
  | { type: 'progressed'; progress: EpubDownloadProgress }
  | { type: 'downloaded'; file: DownloadedEpub }
  | { type: 'sharing' }
  | { type: 'shareFinished' }
  | { type: 'failed'; code: EpubDeliveryErrorCode; message: string; file?: DownloadedEpub | null }
  | { type: 'reset' };

export const initialExportState: ExportState = {
  status: 'idle',
  intent: null,
  file: null,
  progress: null,
  message: null,
  code: null,
};

export function exportReducer(state: ExportState, action: ExportAction): ExportState {
  switch (action.type) {
    case 'downloadStarted':
      return { ...initialExportState, status: 'downloading', intent: action.intent };
    case 'progressed':
      return { ...state, progress: action.progress };
    case 'downloaded':
      return { ...state, status: 'ready', file: action.file, progress: null, message: null, code: null };
    case 'sharing':
      return { ...state, status: 'sharing', message: null, code: null };
    case 'shareFinished':
      return {
        ...state,
        status: 'ready',
        intent: null,
        progress: null,
        message: 'EPUB is ready to share again.',
        code: null,
      };
    case 'failed':
      return {
        ...state,
        status: 'error',
        file: action.file === undefined ? state.file : action.file,
        progress: null,
        message: action.message,
        code: action.code,
      };
    case 'reset':
      return initialExportState;
  }
}
