import { appReducer, initialAppState } from '../appState';

describe('app state', () => {
  test('starts on the scanner', () => {
    expect(initialAppState.screen).toBe('scanner');
  });

  test('records a healthy backend without replacing the active screen', () => {
    expect(appReducer({ ...initialAppState, screen: 'edition' }, { type: 'healthSucceeded' })).toEqual({
      screen: 'edition',
      connectivity: 'online',
      message: 'Backend connected',
    });
  });

  test('preserves a useful failure message without replacing the active screen', () => {
    expect(
      appReducer({ ...initialAppState, screen: 'manualSearch' }, {
        type: 'healthFailed',
        message: 'Connection timed out',
      }),
    ).toEqual({
      screen: 'manualSearch',
      connectivity: 'offline',
      message: 'Connection timed out',
    });
  });

  test('navigates between launch, scanner, and scenarios', () => {
    const scanner = appReducer(initialAppState, { type: 'showScanner' });
    const scenarios = appReducer(scanner, { type: 'showScenarios' });

    expect(scanner.screen).toBe('scanner');
    expect(scenarios.screen).toBe('scenarios');
    expect(appReducer(scenarios, { type: 'showLaunch' }).screen).toBe('launch');
  });
});
