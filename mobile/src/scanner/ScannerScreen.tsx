import { useCallback, useEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import {
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as FileSystem from 'expo-file-system/legacy';
import * as Haptics from 'expo-haptics';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAccessibilityAnnouncement } from '../accessibility/useAccessibilityAnnouncement';
import type { CoverClient, CoverRecognitionResult } from '../api/cover';
import { PrimaryButton, SecondaryButton } from '../ui/primitives';
import { motion } from '../ui/theme';
import { cleanupCoverFiles, prepareCoverPhoto } from './coverCapture';
import { hasFreshISBN, initialScannerState, scannerReducer } from './scannerState';

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
  coverResult?: CoverRecognitionResult;
  coverError?: string;
  coverDelayMs?: number;
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
  onCoverRecognized,
  onIsbnAccepted,
  onManualSearch,
  coverClient,
}: {
  fixture?: ScannerFixture;
  onBack(): void;
  onCoverRecognized(result: CoverRecognitionResult): void;
  onIsbnAccepted(isbn: string): void;
  onManualSearch(): void;
  coverClient?: CoverClient;
}) {
  const [nativePermission, requestNativePermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const abort = useRef<AbortController | null>(null);
  const operationGeneration = useRef(0);
  const localFiles = useRef<string[]>([]);
  const mounted = useRef(true);
  const [coverState, setCoverState] = useState<
    | { status: 'idle' }
    | { status: 'processing'; stage: string; progress: number }
    | { status: 'error'; message: string }
  >({ status: 'idle' });
  const permission = fixture ? fixture.permission : nativePermission;
  const fixtureNow = fixture
    ? () => (fixture.observations?.at(-1)?.at ?? 0) + 100
    : undefined;

  useAccessibilityAnnouncement(
    coverState.status === 'processing'
      ? coverState.stage
      : coverState.status === 'error'
        ? `Could not identify this cover. ${coverState.message}`
        : null,
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      operationGeneration.current += 1;
      abort.current?.abort();
      void cleanupCoverFiles(localFiles.current, FileSystem.deleteAsync);
    };
  }, []);

  const captureCover = useCallback(async () => {
    if (coverState.status === 'processing') return;
    const operation = ++operationGeneration.current;
    const operationIsCurrent = () => mounted.current && operationGeneration.current === operation;
    setCoverState({ status: 'processing', stage: 'Reading the cover…', progress: 0 });
    if (fixture) {
      await new Promise((resolve) => setTimeout(resolve, fixture.coverDelayMs ?? 0));
      if (!operationIsCurrent()) return;
      if (fixture.coverResult) {
        if (fixture.coverResult.status === 'no_match' || fixture.coverResult.candidates.length === 0) {
          setCoverState({
            status: 'error',
            message: 'This cover did not have enough readable detail to identify the book.',
          });
        } else {
          onCoverRecognized(fixture.coverResult);
        }
      } else {
        setCoverState({
          status: 'error',
          message: fixture.coverError ?? 'Cover recognition is unavailable. Try again.',
        });
      }
      return;
    }

    let originalUri: string | undefined;
    let preparedUri: string | undefined;
    let uploadController: AbortController | undefined;
    try {
      const photo = await camera.current?.takePictureAsync({ quality: 1, skipProcessing: false });
      if (!operationIsCurrent()) throw new Error('Cover recognition cancelled');
      if (!photo) throw new Error('The camera did not capture a cover.');
      originalUri = photo.uri;
      localFiles.current.push(originalUri);
      setCoverState({ status: 'processing', stage: 'Preparing the cover…', progress: 0.1 });
      const prepared = await prepareCoverPhoto(photo, async (uri, actions, options) => {
        const result = await manipulateAsync(uri, actions, {
          compress: options.compress,
          format: SaveFormat.JPEG,
        });
        return result;
      });
      if (!operationIsCurrent()) throw new Error('Cover recognition cancelled');
      preparedUri = prepared.uri;
      localFiles.current.push(preparedUri);
      if (!coverClient) throw new Error('Cover recognition is unavailable.');
      uploadController = new AbortController();
      abort.current = uploadController;
      setCoverState({ status: 'processing', stage: 'Checking book records…', progress: 0.2 });
      const result = await coverClient.recognize(
        preparedUri,
        uploadController.signal,
        (progress) => {
          if (operationIsCurrent()) {
            setCoverState({
              status: 'processing',
              stage: progress < 1 ? 'Sending the cover securely…' : 'Reading the cover…',
              progress: Math.max(0.2, progress),
            });
          }
        },
      );
      if (!operationIsCurrent()) return;
      if (result.status === 'no_match' || result.candidates.length === 0) {
        setCoverState({
          status: 'error',
          message: 'This cover did not have enough readable detail to identify the book.',
        });
      } else {
        onCoverRecognized(result);
      }
    } catch (error) {
      if (!operationIsCurrent()) return;
      const message = error instanceof Error ? error.message : 'Cover recognition is unavailable.';
      if (message !== 'Cover recognition cancelled') {
        setCoverState({ status: 'error', message });
      } else {
        setCoverState({ status: 'idle' });
      }
    } finally {
      if (abort.current === uploadController) {
        abort.current = null;
      }
      await cleanupCoverFiles([originalUri, preparedUri], FileSystem.deleteAsync);
      localFiles.current = localFiles.current.filter(
        (uri) => uri !== originalUri && uri !== preparedUri,
      );
    }
  }, [coverClient, coverState.status, fixture, onCoverRecognized]);

  if (coverState.status === 'processing') {
    return (
      <CoverMessageScreen
        title={coverState.stage}
        body="The cover crop is used only for identification and is deleted after this request."
        progress={coverState.progress}
        primaryLabel="Cancel"
        onPrimary={() => {
          operationGeneration.current += 1;
          if (abort.current) {
            abort.current.abort();
          }
          setCoverState({ status: 'idle' });
        }}
      />
    );
  }
  if (coverState.status === 'error') {
    return (
      <CoverRecoveryScreen
        message={coverState.message}
        onManualSearch={onManualSearch}
        onScanAgain={() => setCoverState({ status: 'idle' })}
      />
    );
  }

  return (
    <ScannerView
      permission={permission}
      scriptedObservations={fixture?.observations}
      feedback={fixture ? noFeedback : undefined}
      onBack={onBack}
      onCaptureCover={() => void captureCover()}
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
        : ({ active, onBarcodeScanned }) => (
            <CameraView
              active={active}
              barcodeScannerSettings={{ barcodeTypes: ['ean13'] }}
              facing="back"
              onBarcodeScanned={onBarcodeScanned}
              ref={camera}
              style={StyleSheet.absoluteFill}
            />
          )}
    />
  );
}

export function ScannerView({
  permission,
  onBack,
  onCaptureCover,
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
  onCaptureCover(): void;
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
  useAccessibilityAnnouncement(scannerAnnouncement(permission, scanner.message));

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
        title={undetermined ? 'Scan a cover or ISBN' : permission.canAskAgain ? 'Camera access is off' : 'Camera access is blocked'}
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
        isRecovery={!undetermined}
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
        <Text style={styles.title}>Scan a cover or ISBN</Text>
        <Text style={styles.hint}>The barcode on the back is fastest.</Text>
      </View>
      <View accessible accessibilityLabel="Book scan guide" style={styles.scanGuide}>
        <View style={[styles.corner, styles.topLeft]} />
        <View style={[styles.corner, styles.topRight]} />
        <View style={[styles.corner, styles.bottomLeft]} />
        <View style={[styles.corner, styles.bottomRight]} />
      </View>
      <View style={styles.controls}>
        <Text accessibilityLiveRegion="polite" accessibilityRole="text" style={styles.message}>
          {scanner.message}
        </Text>
        <Pressable
          accessibilityLabel="Capture cover or detected ISBN"
          accessibilityRole="button"
          disabled={scanner.locked}
          onPress={() => {
            const at = now();
            if (hasFreshISBN(scanner, at)) {
              dispatch({ type: 'manualCapture', at });
            } else {
              onCaptureCover();
            }
          }}
          style={({ pressed }) => [
            styles.shutterOuter,
            pressed && styles.pressed,
            { transform: [{ scale: pressed ? motion.pressScale : 1 }] },
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
        <Text style={styles.privacyHint}>
          Cover photos are processed temporarily and not saved.
        </Text>
      </View>
    </SafeAreaView>
  );
}

function scannerAnnouncement(
  permission: CameraPermissionState | null,
  scannerMessage: string,
): string {
  if (!permission) return 'Preparing camera. Checking camera access.';
  if (permission.granted) return scannerMessage;
  if (permission.status === 'undetermined') {
    return 'Camera access is used only to recognize a book cover or ISBN barcode.';
  }
  if (permission.canAskAgain) {
    return 'Camera access is off. Allow camera access to scan a barcode, or search manually.';
  }
  return 'Camera access is blocked. Enable camera access in Settings, or search manually.';
}

function CoverMessageScreen({
  title,
  body,
  progress,
  primaryLabel,
  onPrimary,
}: {
  title: string;
  body: string;
  progress: number;
  primaryLabel: string;
  onPrimary(): void;
}) {
  return (
    <SafeAreaView style={styles.permissionScreen}>
      <StatusBar style="dark" />
      <View style={styles.coverStateContent}>
        <Text accessibilityLiveRegion="polite" style={styles.permissionTitle}>{title}</Text>
        <Text style={styles.permissionBody}>{body}</Text>
        <View accessibilityLabel="Cover upload progress" style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.max(8, progress * 100)}%` }]} />
        </View>
        <SecondaryButton label={primaryLabel} onPress={onPrimary} />
      </View>
    </SafeAreaView>
  );
}

function CoverRecoveryScreen({
  message,
  onManualSearch,
  onScanAgain,
}: {
  message: string;
  onManualSearch(): void;
  onScanAgain(): void;
}) {
  return (
    <SafeAreaView style={styles.permissionScreen}>
      <StatusBar style="dark" />
      <View style={styles.coverStateContent}>
        <Text style={styles.permissionTitle}>Couldn’t identify this cover</Text>
        <Text accessibilityLiveRegion="assertive" accessibilityRole="alert" style={styles.permissionBody}>
          {message}
        </Text>
        <PrimaryButton label="Try another cover" onPress={onScanAgain} />
        <SecondaryButton label="Scan the back barcode" onPress={onScanAgain} />
        <SecondaryButton label="Enter title manually" onPress={onManualSearch} />
      </View>
    </SafeAreaView>
  );
}

function PermissionScreen({
  title,
  body,
  primaryAction,
  isRecovery = false,
  onBack,
  onManualSearch,
}: {
  title: string;
  body: string;
  primaryAction?: { label: string; onPress(): void };
  isRecovery?: boolean;
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
          <Text
            accessibilityLiveRegion={isRecovery ? 'assertive' : 'polite'}
            accessibilityRole={isRecovery ? 'alert' : 'text'}
            style={styles.permissionBody}
          >
            {body}
          </Text>
        </View>
        {primaryAction ? (
          <Pressable
            accessibilityLabel={primaryAction.label}
            accessibilityRole="button"
            onPress={primaryAction.onPress}
            style={({ pressed }) => [
              styles.primaryAction,
              pressed && styles.pressed,
              { transform: [{ scale: pressed ? motion.pressScale : 1 }] },
            ]}
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
  coverStateContent: { flex: 1, gap: 18, justifyContent: 'center', padding: 28 },
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
    aspectRatio: 2 / 3,
    marginVertical: 12,
    maxHeight: 420,
    width: '64%',
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
  privacyHint: { color: '#C3CBC6', fontSize: 12, lineHeight: 17, textAlign: 'center' },
  progressTrack: {
    backgroundColor: '#D9D8D0',
    borderRadius: 3,
    height: 6,
    overflow: 'hidden',
  },
  progressFill: { backgroundColor: '#24342B', borderRadius: 3, height: 6 },
});
