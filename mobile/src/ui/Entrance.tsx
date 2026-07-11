import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing } from 'react-native';

import { motion } from './theme';
import { useReducedMotionStatus } from './useReducedMotion';

const entranceEaseOut = Easing.out(Easing.cubic);

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
  const { isReady, reducedMotion } = useReducedMotionStatus();
  const canEnterOnMount = isReady && !reducedMotion;
  const hasSettled = useRef(!canEnterOnMount);
  const opacity = useRef(new Animated.Value(canEnterOnMount ? 0 : 1)).current;
  const translateY = useRef(new Animated.Value(canEnterOnMount ? distance : 0)).current;

  useEffect(() => {
    if (hasSettled.current || !isReady || reducedMotion) {
      hasSettled.current = true;
      opacity.setValue(1);
      translateY.setValue(0);
      return;
    }

    hasSettled.current = true;
    const animation = Animated.parallel([
      Animated.timing(opacity, {
        delay,
        duration: motion.contentMs,
        easing: entranceEaseOut,
        isInteraction: false,
        toValue: 1,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        delay,
        duration: motion.contentMs,
        easing: entranceEaseOut,
        isInteraction: false,
        toValue: 0,
        useNativeDriver: true,
      }),
    ]);

    animation.start();

    return () => {
      animation.stop();
    };
  }, [delay, distance, isReady, opacity, reducedMotion, translateY]);

  return (
    <Animated.View
      testID={testID}
      style={{ opacity, transform: [{ translateY }] }}
    >
      {children}
    </Animated.View>
  );
}
