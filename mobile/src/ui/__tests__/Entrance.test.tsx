import { render } from '@testing-library/react-native';
import { Animated, Text } from 'react-native';

import { Entrance } from '../Entrance';
import { motion } from '../theme';
import { useReducedMotion } from '../useReducedMotion';

jest.mock('../useReducedMotion', () => ({
  useReducedMotion: jest.fn(),
}));

const mockUseReducedMotion = jest.mocked(useReducedMotion);

function mockReducedMotion(enabled: boolean) {
  mockUseReducedMotion.mockReturnValue(enabled);
}

describe('Entrance', () => {
  beforeEach(() => {
    mockUseReducedMotion.mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('keeps an Entrance visible without a translate transform when motion is reduced', () => {
    mockReducedMotion(true);
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

  test('uses non-blocking native-driver timings when motion is enabled', () => {
    mockReducedMotion(false);
    const timing = jest.spyOn(Animated, 'timing').mockImplementation(() => ({
      reset: jest.fn(),
      start: jest.fn(),
      stop: jest.fn(),
    }));

    render(
      <Entrance delay={40} distance={motion.cardDistance}>
        <Text>Ready</Text>
      </Entrance>,
    );

    expect(timing).toHaveBeenCalledTimes(2);
    expect(timing).toHaveBeenNthCalledWith(
      1,
      expect.any(Animated.Value),
      {
        delay: 40,
        duration: motion.contentMs,
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
        isInteraction: false,
        toValue: 0,
        useNativeDriver: true,
      },
    );
  });
});
