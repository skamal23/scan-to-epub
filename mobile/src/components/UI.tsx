import { useEffect, useRef, useState, type ComponentProps } from 'react';
import {
  Animated,
  ActivityIndicator,
  Easing,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type TextProps,
  type ViewStyle,
} from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { colors, fonts } from '../ui/theme';
import { useReducedMotion } from '../ui/useReducedMotion';

export const feedback = () => {
  void Haptics.selectionAsync().catch(() => undefined);
};
export function Copy({
  style,
  weight = 'regular',
  ...props
}: TextProps & { weight?: keyof typeof fonts }) {
  return (
    <Text
      {...props}
      style={[{ color: colors.ink, fontSize: 16, fontFamily: fonts[weight] }, style]}
    />
  );
}
export type IconName = ComponentProps<typeof Feather>['name'];
export function Icon({
  name,
  size = 22,
  color = colors.ink,
}: {
  name: IconName;
  size?: number;
  color?: string;
}) {
  return <Feather name={name} size={size} color={color} />;
}
export function IconButton({
  name,
  label,
  onPress,
  dark = false,
  selected = false,
}: {
  name: IconName;
  label: string;
  onPress(): void;
  dark?: boolean;
  selected?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={() => {
        feedback();
        onPress();
      }}
      style={({ pressed }) => [
        styles.iconButton,
        {
          backgroundColor: dark ? '#ffffff22' : selected ? colors.ink : colors.surface,
          opacity: pressed ? 0.6 : 1,
        },
      ]}
    >
      <Icon name={name} color={dark || selected ? 'white' : colors.ink} />
    </Pressable>
  );
}
export function Button({
  title,
  onPress,
  icon,
  secondary,
  disabled,
  busy,
}: {
  title: string;
  onPress(): void;
  icon?: IconName;
  secondary?: boolean;
  disabled?: boolean;
  busy?: boolean;
}) {
  const travel = useRef(new Animated.Value(0)).current;
  const reduced = useReducedMotion();
  const [engaged, setEngaged] = useState(false);
  useEffect(() => {
    const animation = Animated.timing(travel, {
      toValue: engaged && !reduced ? 1 : 0,
      duration: 150,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [engaged, reduced, travel]);
  return (
    <Pressable
      onHoverIn={() => setEngaged(true)}
      onHoverOut={() => setEngaged(false)}
      onPressIn={() => setEngaged(true)}
      onPressOut={() => setEngaged(false)}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      onPress={() => {
        feedback();
        onPress();
      }}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: secondary ? 'transparent' : colors.ink,
          opacity: disabled || busy ? 0.45 : pressed ? 0.8 : 1,
          transform: [{ scale: pressed && !reduced ? 0.985 : 1 }],
        },
      ]}
    >
      <Copy weight="semibold" style={{ color: secondary ? colors.ink : 'white' }}>
        {title}
      </Copy>
      {busy ? (
        <ActivityIndicator size="small" color={secondary ? colors.ink : 'white'} />
      ) : icon ? (
        <Animated.View
          style={{
            transform: [
              { translateX: travel.interpolate({ inputRange: [0, 1], outputRange: [0, 4] }) },
            ],
          }}
        >
          <Icon name={icon} color={secondary ? colors.ink : 'white'} size={19} />
        </Animated.View>
      ) : null}
    </Pressable>
  );
}
export function Cover({
  uri,
  title,
  author,
  width = 150,
  lifted = false,
}: {
  uri?: string | null;
  title: string;
  author?: string;
  width?: number;
  lifted?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [uri]);
  return (
    <View
      style={[
        styles.coverShadow,
        { width, height: width * 1.5 },
        lifted && {
          transform: [{ perspective: 900 }, { rotateY: '-12deg' }, { rotateZ: '-3deg' }],
        },
      ]}
    >
      <View style={styles.cover}>
        {uri && !failed ? (
          <Image
            accessibilityLabel={`${title} cover`}
            source={{ uri }}
            onError={() => setFailed(true)}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
          />
        ) : (
          <LinearGradient colors={['#485958', '#202C2D']} style={styles.fallback}>
            <View style={styles.rule} />
            <Copy
              weight="semibold"
              style={[styles.fallbackTitle, { fontSize: Math.max(13, width / 8) }]}
              numberOfLines={5}
            >
              {title}
            </Copy>
            <Copy style={styles.fallbackAuthor} numberOfLines={2}>
              {author || 'A reading edition'}
            </Copy>
            <View style={styles.rule} />
          </LinearGradient>
        )}
        <LinearGradient
          pointerEvents="none"
          colors={['#00000030', '#ffffff36', '#00000008', '#00000000']}
          locations={[0, 0.04, 0.07, 0.13]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
      </View>
    </View>
  );
}
export function Skeleton({
  width = '100%',
  height = 20,
  radius = 10,
}: {
  width?: ViewStyle['width'];
  height?: number;
  radius?: number;
}) {
  const shimmer = useRef(new Animated.Value(-1)).current;
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(
      Animated.timing(shimmer, {
        toValue: 1,
        duration: 1400,
        easing: Easing.linear,
        useNativeDriver: true,
        isInteraction: false,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [shimmer, reduced]);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onLayout={(event) => setMeasuredWidth(event.nativeEvent.layout.width)}
      style={{
        width,
        height,
        borderRadius: radius,
        overflow: 'hidden',
        backgroundColor: '#E8EAED',
      }}
    >
      {!reduced && measuredWidth > 0 ? (
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            {
              transform: [
                {
                  translateX: shimmer.interpolate({
                    inputRange: [-1, 1],
                    outputRange: [-measuredWidth, measuredWidth],
                  }),
                },
              ],
            },
          ]}
        >
          <LinearGradient
            colors={['#FFFFFF00', '#FFFFFF80', '#FFFFFF00']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      ) : null}
    </View>
  );
}
export function EmptyMessage({
  title,
  body,
  action,
  onPress,
}: {
  title: string;
  body: string;
  action?: string;
  onPress?: () => void;
}) {
  return (
    <View style={styles.empty}>
      <Copy weight="semibold" style={{ fontSize: 25, textAlign: 'center' }}>
        {title}
      </Copy>
      <Copy style={{ color: colors.mutedInk, lineHeight: 24, textAlign: 'center' }}>{body}</Copy>
      {action && onPress ? <Button title={action} onPress={onPress} /> : null}
    </View>
  );
}
export const styles = StyleSheet.create({
  iconButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  button: {
    minHeight: 54,
    borderRadius: 27,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    paddingHorizontal: 24,
    paddingVertical: 14,
  },
  coverShadow: {
    shadowColor: '#14191B',
    shadowOpacity: 0.2,
    shadowRadius: 15,
    shadowOffset: { width: 4, height: 12 },
    elevation: 8,
  },
  cover: {
    flex: 1,
    overflow: 'hidden',
    borderRadius: 4,
    borderTopRightRadius: 9,
    borderBottomRightRadius: 9,
    backgroundColor: '#394645',
  },
  fallback: { flex: 1, padding: 16, justifyContent: 'center', gap: 12 },
  fallbackTitle: { color: '#F5F0E5', textAlign: 'center', letterSpacing: -0.5 },
  fallbackAuthor: { color: '#CBD3CA', fontSize: 11, textAlign: 'center' },
  rule: { height: 1, backgroundColor: '#ffffff30', marginVertical: 10 },
  empty: {
    padding: 30,
    gap: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
