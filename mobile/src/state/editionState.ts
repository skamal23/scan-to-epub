import type { EditionResolutionResult } from '../api/editions';

export type EditionState = {
  status: 'idle' | 'searching' | 'resolved' | 'error';
  result: EditionResolutionResult | null;
  message: string | null;
};

export type EditionAction =
  | { type: 'started' }
  | { type: 'succeeded'; result: EditionResolutionResult }
  | { type: 'failed'; message: string }
  | { type: 'reset' };

export const initialEditionState: EditionState = { status: 'idle', result: null, message: null };

export function editionReducer(_state: EditionState, action: EditionAction): EditionState {
  if (action.type === 'started') return { status: 'searching', result: null, message: null };
  if (action.type === 'succeeded') return { status: 'resolved', result: action.result, message: null };
  if (action.type === 'failed') return { status: 'error', result: null, message: action.message };
  return initialEditionState;
}
