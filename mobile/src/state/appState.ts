export type AppState = {
  screen: 'launch' | 'scanner' | 'manualSearch' | 'scenarios';
  connectivity: 'checking' | 'online' | 'offline';
  message: string;
};

export type AppAction =
  | { type: 'healthChecking' }
  | { type: 'healthSucceeded' }
  | { type: 'healthFailed'; message: string }
  | { type: 'showScanner' }
  | { type: 'showManualSearch' }
  | { type: 'showScenarios' }
  | { type: 'showLaunch' };

export const initialAppState: AppState = {
  screen: 'launch',
  connectivity: 'checking',
  message: 'Checking backend…',
};

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'healthChecking':
      return {
        ...state,
        connectivity: 'checking',
        message: 'Checking backend…',
      };
    case 'healthSucceeded':
      return {
        screen: 'launch',
        connectivity: 'online',
        message: 'Backend connected',
      };
    case 'healthFailed':
      return {
        screen: 'launch',
        connectivity: 'offline',
        message: action.message,
      };
    case 'showScanner':
      return { ...state, screen: 'scanner' };
    case 'showManualSearch':
      return { ...state, screen: 'manualSearch' };
    case 'showScenarios':
      return { ...state, screen: 'scenarios' };
    case 'showLaunch':
      return { ...state, screen: 'launch' };
  }
}
