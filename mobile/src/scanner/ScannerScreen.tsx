import { useEffect, useReducer, useRef, type ReactNode } from 'react';
import {
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SecondaryButton } from '../ui/primitives';
import { initialScannerState, scannerReducer } from './scannerState';

export type CameraPermissionState = {
  granted: boolean;
  status: 'granted' | 'denied' | 'undetermined';
  canAskAgain: boolean;
};

export type ScriptedBarcodeObservation = {
  type: string;
  data: string;
  at: number;
};

export type ScannerFixture = {
  permission: CameraPermissionState | null;
  observations?: ScriptedBarcodeObservation[];
};

type CameraRenderer = (options: {
  active: boolean;
  onBarcodeScanned(observation: { type: string; data: string }): void;
}) => ReactNode;

const noFeedback = async () => undefined;

async function successFeedback() {
  await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
}

export function ScannerScreen({
  fixture,
  onBack,
  onIsbnAccepted,
  onManualSearch,
}: {
  fixture?: ScannerFixture;
  onBack(): void;
  onIsbnAccepted(isbn: string): void;
  onManualSearch(): void;
}) {
  const [nativePermission, requestNativePermission] = useCameraPermissions();
  const permission = fixture ? fixture.permission : nativePermission;
  const fixtureNow = fixture
    ? () => (fixture.observations?.at(-1)?.at ?? 0) + 100
    : undefined;

  return (
    <ScannerView
      permission={permission}
      scriptedObservations={fixture?.observations}
      feedback={fixture ? noFeedback : undefined}
      onBack={onBack}
      onIsbnAccepted={onIsbnAccepted}
      onManualSearch={onManualSearch}
      onOpenSettings={() => void Linking.openSettings()}
      onRequestPermission={() => {
        if (!fixture) {
          void requestNativePermission();
        }
      }}
      now={fixtureNow}
      renderCamera={fixture
        ? () => <View accessibilityLabel="Fixture camera preview" style={styles.fixtureCamera} />
        : undefined}
    />
  );
}

export function ScannerView({
  permission,
  onBack,
  onIsbnAccepted,
  onManualSearch,
  onOpenSettings,
  onRequestPermission,
  renderCamera,
  scriptedObservations,
  feedback = successFeedback,
  captureDelayMs = 300,
  now = Date.now,
}: {
  permission: CameraPermissionState | null;
  onBack(): void;
  onIsbnAccepted(isbn: string): void;
  onManualSearch(): void;
  onOpenSettings(): void;
  onRequestPermission(): void;
  renderCamera?: CameraRenderer;
  scriptedObservations?: ScriptedBarcodeObservation[];
  feedback?: () => Promise<void>;
  captureDelayMs?: number;
  now?: () => number;
}) {
  const [scanner, dispatch] = useReducer(scannerReducer, initialScannerState);
  const acceptedHandler = useRef(onIsbnAccepted);
  const feedbackHandler = useRef(feedback);
  const captureDelay = useRef(captureDelayMs);
  acceptedHandler.current = onIsbnAccepted;
  feedbackHandler.current = feedback;
  captureDelay.current = captureDelayMs;

  useEffect(() => {
    for (const observation of scriptedObservations ?? []) {
      dispatch({ type: 'observed', observation, at: observation.at });
    }
  }, [scriptedObservations]);

  useEffect(() => {
    if (!scanner.accepted) {
      return;
    }
    void feedbackHandler.current();
    const timeout = setTimeout(
      () => acceptedHandler.current(scanner.accepted!.isbn),
      captureDelay.current,
    );
    return () => clearTimeout(timeout);
  }, [scanner.accepted]);

  if (!permission) {
    return (
      <PermissionScreen
        title="Preparing camera…"
        body="Checking camera access."
        onBack={onBack}
        onManualSearch={onManualSearch}
      />
    );
  }
  if (!permission.granted) {
    const undetermined = permission.status === 'undetermined';
    const canRequest = undetermined || permission.canAskAgain;
    return (
      <PermissionScreen
        title={undetermined ? 'Scan ISBN barcodes' : permission.canAskAgain ? 'Camera access is off' : 'Camera access is blocked'}
        body={undetermined
          ? 'Camera access is used only to recognize a book cover or ISBN barcode.'
          : permission.canAskAgain
            ? 'Allow camera access to scan a barcode, or search manually.'
            : 'Enable camera access in Settings, or search manually.'}
        primaryAction={canRequest
          ? {
              label: undetermined ? 'Allow camera' : 'Try camera access again',
              onPress: onRequestPermission,
            }
          : { label: 'Open Settings', onPress: onOpenSettings }}
        onBack={onBack}
        onManualSearch={onManualSearch}
      />
    );
  }

  const onBarcodeScanned = (observation: { type: string; data: string }) => {
    dispatch({ type: 'observed', observation, at: now() });
  };
  const camera = renderCamera
    ? renderCamera({ active: !scanner.locked, onBarcodeScanned })
    : (
        <CameraView
          active={!scanner.locked}
          barcodeScannerSettings={{ barcodeTypes: ['ean13'] }}
          facing="back"
          onBarcodeScanned={onBarcodeScanned}
          style={StyleSheet.absoluteFill}
        />
      );

  return (
    <SafeAreaView style={styles.scannerScreen}>
      <StatusBar style="light" />
      <View style={StyleSheet.absoluteFill}>{camera}</View>
      <View style={styles.scrim} pointerEvents="none" />
      <View style={styles.header}>
        <SecondaryButton appearance="onDark" compact label="Back" onPress={onBack} />
        <Text style={styles.title}>Scan the ISBN barcode</Text>
        <Text style={styles.hint}>The barcode on the back is fastest.</Text>
      </View>
      <View accessible accessibilityLabel="ISBN scan guide" style={styles.scanGuide}>
        <View style={[styles.corner, styles.topLeft]} />
        <View style={[styles.corner, styles.topRight]} />
        <View style={[styles.corner, styles.bottomLeft]} />
        <View style={[styles.corner, styles.bottomRight]} />
      </View>
      <View style={styles.controls}>
        <Text accessibilityRole="text" style={styles.message}>{scanner.message}</Text>
        <Pressable
          accessibilityLabel="Capture detected ISBN"
          accessibilityRole="button"
          disabled={scanner.locked}
          onPress={() => dispatch({ type: 'manualCapture', at: now() })}
          style={({ pressed }) => [
            styles.shutterOuter,
            pressed && styles.pressed,
            scanner.locked && styles.disabled,
          ]}
        >
          <View style={styles.shutterInner} />
        </Pressable>
        <SecondaryButton
          appearance="onDark"
          label="Search manually"
          onPress={onManualSearch}
        />
      </View>
    </SafeAreaView>
  );
}

function PermissionScreen({
  title,
  body,
  primaryAction,
  onBack,
  onManualSearch,
}: {
  title: string;
  body: string;
  primaryAction?: { label: string; onPress(): void };
  onBack(): void;
  onManualSearch(): void;
}) {
  return (
    <SafeAreaView style={styles.permissionScreen}>
      <StatusBar style="dark" />
      <View style={styles.permissionContent}>
        <SecondaryButton compact label="Back" onPress={onBack} />
        <View style={styles.permissionCopy}>
          <Text style={styles.permissionTitle}>{title}</Text>
          <Text style={styles.permissionBody}>{body}</Text>
        </View>
        {primaryAction ? (
          <Pressable
            accessibilityLabel={primaryAction.label}
            accessibilityRole="button"
            onPress={primaryAction.onPress}
            style={({ pressed }) => [styles.primaryAction, pressed && styles.pressed]}
          >
            <Text style={styles.primaryActionText}>{primaryAction.label}</Text>
          </Pressable>
        ) : null}
        <SecondaryButton label="Search manually" onPress={onManualSearch} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  permissionScreen: { backgroundColor: '#F4F1EA', flex: 1 },
  permissionContent: { flex: 1, gap: 18, justifyContent: 'center', padding: 28 },
  permissionCopy: { gap: 10, marginVertical: 8 },
  permissionTitle: { color: '#1D241F', fontSize: 32, fontWeight: '700' },
  permissionBody: { color: '#575750', fontSize: 17, lineHeight: 24 },
  primaryAction: {
    alignItems: 'center',
    backgroundColor: '#24342B',
    borderRadius: 14,
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: 20,
  },
  primaryActionText: { color: '#FFFFFF', fontSize: 17, fontWeight: '600' },
  scannerScreen: { backgroundColor: '#111713', flex: 1, overflow: 'hidden' },
  fixtureCamera: { backgroundColor: '#18231D', flex: 1 },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(5, 10, 7, 0.35)' },
  header: { gap: 10, padding: 24 },
  title: { color: '#FFFFFF', fontSize: 24, fontWeight: '600' },
  hint: { color: '#C3CBC6', fontSize: 15 },
  scanGuide: {
    alignSelf: 'center',
    flex: 1,
    marginVertical: 18,
    maxHeight: 260,
    width: '82%',
  },
  corner: { borderColor: '#F5F0E5', height: 38, position: 'absolute', width: 38 },
  topLeft: { borderLeftWidth: 3, borderTopWidth: 3, left: 0, top: 0 },
  topRight: { borderRightWidth: 3, borderTopWidth: 3, right: 0, top: 0 },
  bottomLeft: { borderBottomWidth: 3, borderLeftWidth: 3, bottom: 0, left: 0 },
  bottomRight: { borderBottomWidth: 3, borderRightWidth: 3, bottom: 0, right: 0 },
  controls: { gap: 14, padding: 24 },
  message: { color: '#FFFFFF', fontSize: 15, minHeight: 20, textAlign: 'center' },
  shutterOuter: {
    alignItems: 'center',
    alignSelf: 'center',
    borderColor: '#FFFFFF',
    borderRadius: 40,
    borderWidth: 3,
    height: 72,
    justifyContent: 'center',
    width: 72,
  },
  shutterInner: { backgroundColor: '#FFFFFF', borderRadius: 29, height: 56, width: 56 },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.45 },
});
