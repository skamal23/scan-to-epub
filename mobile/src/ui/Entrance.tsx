import { useEffect, useRef, type ReactNode } from 'react';
import { Animated } from 'react-native';

import { motion } from './theme';
import { useReducedMotion } from './useReducedMotion';

type EntranceProps = {
  children: ReactNode;
  distance?: number;
  delay?: number;
  testID?: string;
};

export function Entrance({
  children,
  distance = motion.contentDistance,
  delay = 0,
  testID,
}: EntranceProps) {
  const reducedMotion = useReducedMotion();
  const opacity = useRef(new Animated.Value(reducedMotion ? 1 : 0)).current;
  const translateY = useRef(new Animated.Value(reducedMotion ? 0 : distance)).current;

  useEffect(() => {
    if (reducedMotion) {
      opacity.setValue(1);
      translateY.setValue(0);
      return;
    }

    opacity.setValue(0);
    translateY.setValue(distance);
    const animation = Animated.parallel([
      Animated.timing(opacity, {
        delay,
        duration: motion.contentMs,
        isInteraction: false,
        toValue: 1,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        delay,
        duration: motion.contentMs,
        isInteraction: false,
        toValue: 0,
        useNativeDriver: true,
      }),
    ]);

    animation.start();

    return () => {
      animation.stop();
    };
  }, [delay, distance, opacity, reducedMotion, translateY]);

  return (
    <Animated.View
      testID={testID}
      style={{ opacity, transform: [{ translateY }] }}
    >
      {children}
    </Animated.View>
  );
}
