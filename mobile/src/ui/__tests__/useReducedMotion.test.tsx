import { act, render, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, Text } from 'react-native';

import { useReducedMotion, useReducedMotionStatus } from '../useReducedMotion';

let reduceMotionListener: ((enabled: boolean) => void) | undefined;
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

describe('useReducedMotion', () => {
  beforeEach(() => {
    reduceMotionListener = undefined;
    removeListener = jest.fn();
    mockIsReduceMotionEnabled = jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(false);
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation(
      ((eventName: string, listener: (enabled: boolean) => void) => {
        if (eventName === 'reduceMotionChanged') {
          reduceMotionListener = listener;
        }

        return { remove: removeListener };
      }) as never,
    );
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

    act(() => {
      reduceMotionListener?.(true);
    });

    expect(view.getByText('ready-reduced')).toBeTruthy();

    await act(async () => {
      resolveInitialPreference(false);
      await initialPreference;
    });

    expect(view.getByText('ready-reduced')).toBeTruthy();
  });

  test('uses the latest preference and listens for later changes', async () => {
    const view = render(<Probe />);

    expect(view.getByText('reduced')).toBeTruthy();
    await waitFor(() => expect(view.getByText('full')).toBeTruthy());

    act(() => {
      reduceMotionListener?.(true);
    });

    expect(view.getByText('reduced')).toBeTruthy();
  });

  test('keeps a newer preference event when the initial read resolves later', async () => {
    let resolveInitialPreference!: (enabled: boolean) => void;
    const initialPreference = new Promise<boolean>((resolve) => {
      resolveInitialPreference = resolve;
    });
    mockIsReduceMotionEnabled.mockReturnValue(initialPreference);
    const view = render(<Probe />);

    expect(view.getByText('reduced')).toBeTruthy();

    act(() => {
      reduceMotionListener?.(false);
    });

    expect(view.getByText('full')).toBeTruthy();

    await act(async () => {
      resolveInitialPreference(true);
      await initialPreference;
    });

    expect(view.getByText('full')).toBeTruthy();
  });

  test('removes its preference listener when unmounted', async () => {
    const view = render(<Probe />);

    await waitFor(() => expect(view.getByText('full')).toBeTruthy());
    view.unmount();

    expect(removeListener).toHaveBeenCalledTimes(1);
  });

  test('starts later consumers with the latest known preference', async () => {
    const first = render(<StatusProbe />);

    expect(first.getByText('ready-full')).toBeTruthy();

    const later = render(<StatusProbe />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(later.getByText('ready-full')).toBeTruthy();
    expect(mockIsReduceMotionEnabled).toHaveBeenCalled();
  });
});
