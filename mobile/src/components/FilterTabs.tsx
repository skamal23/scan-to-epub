import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { Copy, feedback } from './UI';
import { useReducedMotion } from '../ui/useReducedMotion';
const filters = ['All books', 'Reading', 'Finished'];
export function FilterTabs({ value, onChange }: { value: string; onChange(value: string): void }) {
  const [width, setWidth] = useState(0);
  const offset = useRef(new Animated.Value(filters.indexOf(value))).current;
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced) {
      offset.setValue(filters.indexOf(value));
      return;
    }
    const animation = Animated.spring(offset, {
      toValue: filters.indexOf(value),
      damping: 26,
      stiffness: 260,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [offset, reduced, value]);
  return (
    <View style={s.tabs} onLayout={(event) => setWidth(event.nativeEvent.layout.width - 8)}>
      {width > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[
            s.indicator,
            {
              width: width / 3,
              transform: [
                {
                  translateX: offset.interpolate({
                    inputRange: [0, 2],
                    outputRange: [0, (width * 2) / 3],
                  }),
                },
              ],
            },
          ]}
        />
      ) : null}
      {filters.map((filter) => (
        <Pressable
          key={filter}
          accessibilityRole="tab"
          accessibilityState={{ selected: value === filter }}
          onPress={() => {
            feedback();
            onChange(filter);
          }}
          style={[
            s.item,
            !width && value === filter && { backgroundColor: 'white', borderRadius: 24 },
          ]}
        >
          <Copy
            weight={value === filter ? 'medium' : 'regular'}
            style={{
              fontSize: 14,
              color: value === filter ? '#212529' : '#686E73',
              textAlign: 'center',
            }}
          >
            {filter}
          </Copy>
        </Pressable>
      ))}
    </View>
  );
}
const s = StyleSheet.create({
  tabs: {
    flexDirection: 'row',
    padding: 4,
    borderRadius: 28,
    backgroundColor: '#EAECED',
    marginTop: -12,
  },
  indicator: {
    position: 'absolute',
    left: 4,
    top: 4,
    bottom: 4,
    borderRadius: 24,
    backgroundColor: 'white',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
  },
  item: {
    flex: 1,
    minHeight: 44,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
