import { useReducedMotion } from '../ui/useReducedMotion';
import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Copy, IconButton } from './UI';
export function Sheet({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose(): void;
  children: ReactNode;
}) {
  const reduced = useReducedMotion();
  return (
    <Modal
      visible={visible}
      transparent
      animationType={reduced ? 'none' : 'slide'}
      onRequestClose={onClose}
    >
      <View style={s.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityLabel="Dismiss sheet"
          onPress={onClose}
        />
        <SafeAreaView edges={['bottom']} style={s.sheet}>
          <View style={s.handle} />
          <View style={s.heading}>
            <Copy weight="semibold" style={{ fontSize: 21, flex: 1, paddingRight: 12 }}>
              {title}
            </Copy>
            <IconButton name="x" label={`Close ${title}`} onPress={onClose} />
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: 24, paddingTop: 8, gap: 18 }}
          >
            {children}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}
const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: '#00000040',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  sheet: {
    backgroundColor: 'white',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    width: '100%',
    maxWidth: 620,
    maxHeight: '85%',
  },
  handle: {
    width: 35,
    height: 4,
    borderRadius: 3,
    backgroundColor: '#DDE0E2',
    alignSelf: 'center',
    marginTop: 12,
  },
  heading: {
    padding: 24,
    paddingBottom: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});
