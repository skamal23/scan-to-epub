import { render } from '@testing-library/react-native';
import { Animated, Text } from 'react-native';

import { Entrance } from '../Entrance';
import { motion } from '../theme';
import { useReducedMotionStatus } from '../useReducedMotion';

jest.mock('../useReducedMotion', () => ({
  useReducedMotionStatus: jest.fn(),
}));

const mockUseReducedMotionStatus = jest.mocked(useReducedMotionStatus);

type MotionStatus = {
  isReady: boolean;
  reducedMotion: boolean;
};

function mockMotion(status: MotionStatus) {
  mockUseReducedMotionStatus.mockReturnValue(status);
}

describe('Entrance', () => {
  beforeEach(() => {
    mockUseReducedMotionStatus.mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('keeps an Entrance visible without a translate transform when motion is reduced', () => {
    mockMotion({ isReady: true, reducedMotion: true });
    const timing = jest.spyOn(Animated, 'timing');
    const setValue = jest.spyOn(Animated.Value.prototype, 'setValue');
    const view = render(
      <Entrance testID="entrance">
        <Text>Ready</Text>
      </Entrance>,
    );

    const entrance = view.getByTestId('entrance');

    expect(entrance).toBeTruthy();
    expect(setValue).toHaveBeenCalledWith(1);
    expect(setValue).toHaveBeenCalledWith(0);
    expect(timing).not.toHaveBeenCalled();
  });

  test('keeps an Entrance visible without timing while the motion preference is unknown', () => {
    mockMotion({ isReady: false, reducedMotion: false });
    const timing = jest.spyOn(Animated, 'timing');
    const setValue = jest.spyOn(Animated.Value.prototype, 'setValue');
    const view = render(
      <Entrance testID="entrance">
        <Text>Ready</Text>
      </Entrance>,
    );

    expect(view.getByTestId('entrance')).toBeTruthy();
    expect(setValue).toHaveBeenCalledWith(1);
    expect(setValue).toHaveBeenCalledWith(0);
    expect(timing).not.toHaveBeenCalled();
  });

  test('does not replay visible content when an unknown preference resolves to normal motion', () => {
    mockMotion({ isReady: false, reducedMotion: false });
    const timing = jest.spyOn(Animated, 'timing');
    const setValue = jest.spyOn(Animated.Value.prototype, 'setValue');
    const view = render(
      <Entrance distance={motion.cardDistance} testID="entrance">
        <Text>Ready</Text>
      </Entrance>,
    );

    setValue.mockClear();
    mockMotion({ isReady: true, reducedMotion: false });
    view.rerender(
      <Entrance distance={motion.cardDistance} testID="entrance">
        <Text>Ready</Text>
      </Entrance>,
    );

    expect(view.getByTestId('entrance')).toBeTruthy();
    expect(setValue).toHaveBeenCalledWith(1);
    expect(setValue).toHaveBeenCalledWith(0);
    expect(setValue).not.toHaveBeenCalledWith(motion.cardDistance);
    expect(timing).not.toHaveBeenCalled();
  });

  test('uses non-blocking native-driver timings when motion is enabled', () => {
    mockMotion({ isReady: true, reducedMotion: false });
    const timing = jest.spyOn(Animated, 'timing').mockImplementation(() => ({
      reset: jest.fn(),
      start: jest.fn(),
      stop: jest.fn(),
    }));
    const setValue = jest.spyOn(Animated.Value.prototype, 'setValue');

    render(
      <Entrance delay={40} distance={motion.cardDistance}>
        <Text>Ready</Text>
      </Entrance>,
    );

    expect(timing).toHaveBeenCalledTimes(2);
    expect(setValue).not.toHaveBeenCalled();
    expect(timing).toHaveBeenNthCalledWith(
      1,
      expect.any(Animated.Value),
      {
        delay: 40,
        duration: motion.contentMs,
        easing: expect.any(Function),
        isInteraction: false,
        toValue: 1,
        useNativeDriver: true,
      },
    );
    expect(timing).toHaveBeenNthCalledWith(
      2,
      expect.any(Animated.Value),
      {
        delay: 40,
        duration: motion.contentMs,
        easing: expect.any(Function),
        isInteraction: false,
        toValue: 0,
        useNativeDriver: true,
      },
    );

    const firstTimingConfig = timing.mock.calls[0][1] as { easing: (value: number) => number };
    expect(firstTimingConfig.easing(0.5)).toBeCloseTo(0.875);
  });

  test('does not restart a settled entrance when Reduce Motion changes from enabled to disabled', () => {
    mockMotion({ isReady: true, reducedMotion: true });
    const timing = jest.spyOn(Animated, 'timing');
    const view = render(
      <Entrance testID="entrance">
        <Text>Ready</Text>
      </Entrance>,
    );

    mockMotion({ isReady: true, reducedMotion: false });
    view.rerender(
      <Entrance testID="entrance">
        <Text>Ready</Text>
      </Entrance>,
    );

    expect(view.getByTestId('entrance')).toBeTruthy();
    expect(timing).not.toHaveBeenCalled();
  });
});
