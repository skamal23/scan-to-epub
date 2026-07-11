import { act, render, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, Text } from 'react-native';

import { useReducedMotion } from '../useReducedMotion';

let reduceMotionListener: ((enabled: boolean) => void) | undefined;
let removeListener: jest.Mock;
let mockIsReduceMotionEnabled: jest.SpyInstance<Promise<boolean>, []>;

function Probe() {
  const reducedMotion = useReducedMotion();

  return <Text>{reducedMotion ? 'reduced' : 'full'}</Text>;
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

  test('uses the current Reduce Motion preference and listens for later changes', async () => {
    mockIsReduceMotionEnabled.mockResolvedValue(true);
    const view = render(<Probe />);

    await waitFor(() => expect(view.getByText('reduced')).toBeTruthy());
    expect(mockIsReduceMotionEnabled).toHaveBeenCalledTimes(1);

    act(() => {
      reduceMotionListener?.(false);
    });

    expect(view.getByText('full')).toBeTruthy();
  });

  test('keeps a newer preference event when the initial read resolves later', async () => {
    let resolveInitialPreference!: (enabled: boolean) => void;
    const initialPreference = new Promise<boolean>((resolve) => {
      resolveInitialPreference = resolve;
    });
    mockIsReduceMotionEnabled.mockReturnValue(initialPreference);
    const view = render(<Probe />);

    expect(view.getByText('full')).toBeTruthy();

    act(() => {
      reduceMotionListener?.(true);
    });

    expect(view.getByText('reduced')).toBeTruthy();

    await act(async () => {
      resolveInitialPreference(false);
      await initialPreference;
    });

    expect(view.getByText('reduced')).toBeTruthy();
  });

  test('removes its preference listener when unmounted', async () => {
    const view = render(<Probe />);

    await waitFor(() => expect(view.getByText('full')).toBeTruthy());
    view.unmount();

    expect(removeListener).toHaveBeenCalledTimes(1);
  });
});
