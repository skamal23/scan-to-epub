import { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Button, Copy } from './UI';
import { BookObject, bookHeroTop, bookHeroWidth } from './BookObject';
import { useReducedMotionStatus } from '../ui/useReducedMotion';
import type { PreviewFrame } from '../scanner/coverCapture';
import { colors } from '../ui/theme';

export function ScanningCover({
  uri,
  title,
  author,
  origin,
  ready,
  onLiftComplete,
  onCancel,
}: {
  uri?: string | null;
  title: string;
  author?: string;
  origin?: PreviewFrame;
  ready: boolean;
  onLiftComplete(): void;
  onCancel(): void;
}) {
  const lift = useRef(new Animated.Value(0)).current;
  const { isReady, reducedMotion } = useReducedMotionStatus();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const bookWidth = bookHeroWidth(height),
    top = insets.top + bookHeroTop;
  const done = useRef(onLiftComplete);
  done.current = onLiftComplete;
  useEffect(() => {
    if (!ready || !isReady) return;
    if (reducedMotion) {
      lift.setValue(1);
      done.current();
      return;
    }
    const animation = Animated.timing(lift, {
      toValue: 1,
      duration: 760,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (finished) done.current();
    });
    return () => animation.stop();
  }, [lift, ready, isReady, reducedMotion]);
  const guide = origin?.guide;
  const startScale = guide ? guide.width / bookWidth : 0.9;
  const fromX = guide ? guide.x + guide.width / 2 - width / 2 : 0;
  const fromY = guide ? guide.y + guide.height / 2 - (top + bookWidth * 0.75) : 55;
  return (
    <View style={StyleSheet.absoluteFill} accessibilityViewIsModal testID="scan-reveal">
      <StatusBar style={ready ? 'dark' : 'light'} />
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: 'white',
            opacity: lift.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 0.05, 1] }),
          },
        ]}
      />
      {ready ? (
        <Animated.View
          testID="scan-book"
          style={{
            position: 'absolute',
            top,
            left: (width - bookWidth) / 2,
            transform: [
              { perspective: 900 },
              { translateX: lift.interpolate({ inputRange: [0, 1], outputRange: [fromX, 0] }) },
              { translateY: lift.interpolate({ inputRange: [0, 1], outputRange: [fromY, 0] }) },
              {
                scale: lift.interpolate({
                  inputRange: [0, 0.3, 1],
                  outputRange: [startScale, Math.max(startScale * 1.08, 1.1), 1],
                }),
              },
              {
                rotateY: lift.interpolate({
                  inputRange: [0, 0.55, 1],
                  outputRange: ['0deg', '-25deg', '-18deg'],
                }),
              },
              { rotateZ: lift.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-2deg'] }) },
            ],
          }}
        >
          <BookObject uri={uri} title={title} author={author} width={bookWidth} />
        </Animated.View>
      ) : null}
      <Animated.View
        style={[s.status, { top: top + bookWidth * 1.5 + 64, opacity: ready ? lift : 0 }]}
      >
        <ActivityIndicator size="small" color={colors.mutedInk} />
        <Copy accessibilityLiveRegion="polite" style={s.label}>
          Finding your book…
        </Copy>
      </Animated.View>
      <View style={[s.cancel, { bottom: Math.max(insets.bottom, 16) + 16 }]}>
        <Button title="Cancel" secondary onPress={onCancel} />
      </View>
    </View>
  );
}
const s = StyleSheet.create({
  status: {
    position: 'absolute',
    left: 24,
    right: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  label: { color: colors.mutedInk, fontSize: 15 },
  cancel: {
    position: 'absolute',
    alignSelf: 'center',
    minWidth: 100,
    backgroundColor: '#FFFFFFE8',
    borderRadius: 27,
  },
});
