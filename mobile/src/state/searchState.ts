import type { MetadataCandidate } from '../api/metadata';

export type SearchState = {
  status: 'idle' | 'searching' | 'candidates' | 'empty' | 'error' | 'confirmed';
  candidates: MetadataCandidate[];
  providerFailures: string[];
  selected: MetadataCandidate | null;
  message: string | null;
};

export type SearchAction =
  | { type: 'started' }
  | {
      type: 'succeeded';
      candidates: MetadataCandidate[];
      providerFailures: string[];
    }
  | { type: 'failed'; message: string }
  | { type: 'confirmed'; candidate: MetadataCandidate }
  | { type: 'reset' };

export const initialSearchState: SearchState = {
  status: 'idle',
  candidates: [],
  providerFailures: [],
  selected: null,
  message: null,
};

export function searchReducer(state: SearchState, action: SearchAction): SearchState {
  switch (action.type) {
    case 'started':
      return { ...initialSearchState, status: 'searching' };
    case 'succeeded':
      return {
        ...initialSearchState,
        status: action.candidates.length > 0 ? 'candidates' : 'empty',
        candidates: action.candidates,
        providerFailures: action.providerFailures,
      };
    case 'failed':
      return { ...initialSearchState, status: 'error', message: action.message };
    case 'confirmed':
      return { ...state, status: 'confirmed', selected: action.candidate };
    case 'reset':
      return initialSearchState;
  }
}
