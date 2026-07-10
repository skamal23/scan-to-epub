import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

type ButtonProps = {
  label: string;
  onPress(): void;
};

export function PrimaryButton({ label, onPress }: ButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
    >
      <Text style={styles.primaryButtonText}>{label}</Text>
    </Pressable>
  );
}

type SecondaryButtonProps = ButtonProps & {
  appearance?: 'default' | 'onDark';
  compact?: boolean;
};

export function SecondaryButton({
  appearance = 'default',
  compact = false,
  label,
  onPress,
}: SecondaryButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.secondaryButton,
        appearance === 'onDark' && styles.secondaryButtonOnDark,
        compact && styles.compactButton,
        pressed && styles.pressed,
      ]}
    >
      <Text
        style={[
          styles.secondaryButtonText,
          appearance === 'onDark' && styles.secondaryButtonTextOnDark,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function StatusMessage({ tone, text }: {
  tone: 'neutral' | 'success' | 'error';
  text: string;
}) {
  return (
    <View style={styles.statusRow} accessibilityRole="text">
      <View style={[styles.statusDot, statusTone[tone]]} />
      <Text style={styles.statusText}>{text}</Text>
    </View>
  );
}

export function BookCard({ title, author }: { title: string; author: string | null }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {author ? <Text style={styles.cardAuthor}>{author}</Text> : null}
    </View>
  );
}

export function SheetContainer({ children }: { children: ReactNode }) {
  return <View style={styles.sheet}>{children}</View>;
}

export function LoadingIndicator({ label }: { label: string }) {
  return (
    <View style={styles.loadingRow}>
      <ActivityIndicator color="#4F6D5B" />
      <Text style={styles.statusText}>{label}</Text>
    </View>
  );
}

const statusTone = StyleSheet.create({
  neutral: { backgroundColor: '#8A8A84' },
  success: { backgroundColor: '#4F6D5B' },
  error: { backgroundColor: '#9B4A46' },
});

const styles = StyleSheet.create({
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#24342B',
    borderRadius: 14,
    minHeight: 52,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  primaryButtonText: { color: '#FFFFFF', fontSize: 17, fontWeight: '600' },
  secondaryButton: {
    alignItems: 'center',
    borderColor: '#C8C5BD',
    borderRadius: 14,
    borderWidth: 1,
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  secondaryButtonText: { color: '#24342B', fontSize: 16, fontWeight: '600' },
  secondaryButtonOnDark: { borderColor: '#66736B' },
  secondaryButtonTextOnDark: { color: '#FFFFFF' },
  compactButton: { alignSelf: 'flex-start', minHeight: 44, paddingHorizontal: 16 },
  pressed: { opacity: 0.72 },
  statusRow: { alignItems: 'center', flexDirection: 'row', gap: 9 },
  statusDot: { borderRadius: 5, height: 10, width: 10 },
  statusText: { color: '#575750', fontSize: 15 },
  card: {
    backgroundColor: '#FFFFFF',
    borderColor: '#DEDAD1',
    borderRadius: 16,
    borderWidth: 1,
    gap: 4,
    padding: 16,
  },
  cardTitle: { color: '#1D241F', fontSize: 18, fontWeight: '600' },
  cardAuthor: { color: '#686861', fontSize: 15 },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
  },
  loadingRow: { alignItems: 'center', flexDirection: 'row', gap: 10 },
});
