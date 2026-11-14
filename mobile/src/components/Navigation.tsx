import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Copy, Icon, feedback } from './UI';
import { useReducedMotion } from '../ui/useReducedMotion';
export type Tab = 'library' | 'scan' | 'settings';
const tabs: Tab[] = ['library', 'scan', 'settings'];
export function Navigation({ selected, onSelect }: { selected: Tab; onSelect(tab: Tab): void }) {
  const inset = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const [width, setWidth] = useState(0);
  const position = useRef(new Animated.Value(tabs.indexOf(selected))).current;
  useEffect(() => {
    if (reduced) {
      position.setValue(tabs.indexOf(selected));
      return;
    }
    const animation = Animated.spring(position, {
      toValue: tabs.indexOf(selected),
      damping: 24,
      stiffness: 240,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [selected, reduced, position]);
  return (
    <View style={[s.position, { bottom: Math.max(inset.bottom, 16) }]} pointerEvents="box-none">
      <View style={s.bar} onLayout={(event) => setWidth(event.nativeEvent.layout.width - 16)}>
        {width > 0 ? (
          <Animated.View
            pointerEvents="none"
            style={[
              s.indicator,
              {
                width: width / 3,
                transform: [
                  {
                    translateX: position.interpolate({
                      inputRange: [0, 2],
                      outputRange: [0, (width * 2) / 3],
                    }),
                  },
                ],
              },
            ]}
          />
        ) : null}
        {tabs.map((tab) => (
          <Pressable
            key={tab}
            accessibilityRole="tab"
            accessibilityLabel={
              tab === 'library' ? 'Library' : tab === 'scan' ? 'Scan a book' : 'Settings'
            }
            accessibilityState={{ selected: selected === tab }}
            onPress={() => {
              feedback();
              onSelect(tab);
            }}
            style={({ pressed }) => [
              s.item,
              {
                opacity: pressed ? 0.65 : 1,
                backgroundColor: !width && selected === tab ? 'white' : 'transparent',
              },
            ]}
          >
            <Icon
              name={tab === 'library' ? 'book-open' : tab === 'scan' ? 'maximize' : 'sliders'}
              color={selected === tab ? '#212529' : '#D9DDDE'}
              size={20}
            />
            <Copy
              weight="medium"
              style={{ fontSize: 11, color: selected === tab ? '#212529' : '#D9DDDE' }}
            >
              {tab === 'library' ? 'Library' : tab === 'scan' ? 'Scan' : 'Settings'}
            </Copy>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
const s = StyleSheet.create({
  position: { position: 'absolute', left: 30, right: 30, alignItems: 'center' },
  bar: {
    width: '100%',
    maxWidth: 330,
    backgroundColor: '#212529',
    borderRadius: 38,
    padding: 8,
    flexDirection: 'row',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 8 },
  },
  indicator: {
    position: 'absolute',
    top: 8,
    bottom: 8,
    left: 8,
    backgroundColor: 'white',
    borderRadius: 28,
  },
  item: {
    flex: 1,
    minHeight: 52,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 7,
  },
});
