import { appReducer, initialAppState } from '../appState';

describe('app state', () => {
  test('moves from checking to a connected launch screen', () => {
    expect(appReducer(initialAppState, { type: 'healthSucceeded' })).toEqual({
      screen: 'launch',
      connectivity: 'online',
      message: 'Backend connected',
    });
  });

  test('preserves a useful failure message', () => {
    expect(
      appReducer(initialAppState, {
        type: 'healthFailed',
        message: 'Connection timed out',
      }),
    ).toEqual({
      screen: 'launch',
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
