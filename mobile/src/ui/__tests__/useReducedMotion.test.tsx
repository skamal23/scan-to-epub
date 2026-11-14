import { act, render, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, Text } from 'react-native';

import { useReducedMotion, useReducedMotionStatus } from '../useReducedMotion';

let reduceMotionListeners: Set<(enabled: boolean) => void>;
let removeListener: jest.Mock;
let mockIsReduceMotionEnabled: jest.SpyInstance<Promise<boolean>, []>;

function Probe() {
  const reducedMotion = useReducedMotion();

  return <Text>{reducedMotion ? 'reduced' : 'full'}</Text>;
}

function StatusProbe() {
  const { isReady, reducedMotion } = useReducedMotionStatus();

  if (!isReady) return <Text>unknown</Text>;
  return <Text>{reducedMotion ? 'ready-reduced' : 'ready-full'}</Text>;
}

function emitReduceMotion(enabled: boolean) {
  act(() => {
    reduceMotionListeners.forEach((listener) => listener(enabled));
  });
}

describe('useReducedMotion', () => {
  beforeEach(() => {
    reduceMotionListeners = new Set();
    removeListener = jest.fn();
    mockIsReduceMotionEnabled = jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(false);
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation(((
      eventName: string,
      listener: (enabled: boolean) => void,
    ) => {
      if (eventName === 'reduceMotionChanged') {
        reduceMotionListeners.add(listener);
        return {
          remove: () => {
            reduceMotionListeners.delete(listener);
            removeListener();
          },
        };
      }

      return { remove: removeListener };
    }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('keeps the preference unknown until a deferred initial read or newer event resolves it', async () => {
    let resolveInitialPreference!: (enabled: boolean) => void;
    const initialPreference = new Promise<boolean>((resolve) => {
      resolveInitialPreference = resolve;
    });
    mockIsReduceMotionEnabled.mockReturnValue(initialPreference);
    const view = render(<StatusProbe />);

    expect(view.getByText('unknown')).toBeTruthy();

    emitReduceMotion(true);

    expect(view.getByText('ready-reduced')).toBeTruthy();

    await act(async () => {
      resolveInitialPreference(false);
      await initialPreference;
    });

    expect(view.getByText('ready-reduced')).toBeTruthy();
    view.unmount();
  });

  test('clears a cached preference after all observers unmount', async () => {
    const first = render(<StatusProbe />);

    emitReduceMotion(false);
    expect(first.getByText('ready-full')).toBeTruthy();
    first.unmount();

    let resolveFreshPreference!: (enabled: boolean) => void;
    const freshPreference = new Promise<boolean>((resolve) => {
      resolveFreshPreference = resolve;
    });
    mockIsReduceMotionEnabled.mockReturnValue(freshPreference);
    const fresh = render(<StatusProbe />);

    expect(fresh.getByText('unknown')).toBeTruthy();

    await act(async () => {
      resolveFreshPreference(false);
      await freshPreference;
    });

    expect(fresh.getByText('ready-full')).toBeTruthy();
    fresh.unmount();
  });

  test('keeps later screen consumers fresh while an observer stays mounted', () => {
    const observer = render(<StatusProbe />);

    emitReduceMotion(false);
    expect(observer.getByText('ready-full')).toBeTruthy();

    const firstScreen = render(<StatusProbe />);
    expect(firstScreen.getByText('ready-full')).toBeTruthy();
    firstScreen.unmount();

    emitReduceMotion(true);
    expect(observer.getByText('ready-reduced')).toBeTruthy();

    const laterScreen = render(<StatusProbe />);
    expect(laterScreen.getByText('ready-reduced')).toBeTruthy();

    laterScreen.unmount();
    observer.unmount();
  });

  test('preserves the boolean helper and listener cleanup', () => {
    const view = render(<Probe />);

    emitReduceMotion(false);
    expect(view.getByText('full')).toBeTruthy();

    emitReduceMotion(true);
    expect(view.getByText('reduced')).toBeTruthy();

    view.unmount();
    expect(removeListener).toHaveBeenCalledTimes(1);
  });
  test('falls back to a usable static screen if reading the preference fails', async () => {
    mockIsReduceMotionEnabled.mockRejectedValue(new Error('Unavailable'));
    const view = render(<StatusProbe />);
    await waitFor(() => expect(view.getByText('ready-reduced')).toBeTruthy());
    view.unmount();
  });
});
