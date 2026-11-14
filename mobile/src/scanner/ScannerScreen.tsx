import { useCallback, useEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import {
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as FileSystem from 'expo-file-system/legacy';
import * as Haptics from 'expo-haptics';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAccessibilityAnnouncement } from '../accessibility/useAccessibilityAnnouncement';
import type { CoverClient, CoverRecognitionResult } from '../api/cover';
import { Entrance } from '../ui/Entrance';
import { SecondaryButton } from '../ui/primitives';
import { colors, fonts, motion, radius, spacing, type } from '../ui/theme';
import { ScanningCover } from '../components/ScanningCover';
import { Cover, Copy, IconButton, Button } from '../components/UI';
import { cleanupCoverFiles, prepareCoverPhoto, type PreviewFrame } from './coverCapture';
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
  onCoverRecognized(result: CoverRecognitionResult, preview?: string): void;
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
  const [capturePreview, setCapturePreview] = useState<string | undefined>();
  const [captureFrame, setCaptureFrame] = useState<PreviewFrame>();
  const [liftComplete, setLiftComplete] = useState(false);
  const [recognized, setRecognized] = useState<{
    result: CoverRecognitionResult;
    preview?: string;
  }>();
  useEffect(() => {
    if (liftComplete && recognized) onCoverRecognized(recognized.result, recognized.preview);
  }, [liftComplete, recognized, onCoverRecognized]);
  const [coverState, setCoverState] = useState<
    | { status: 'idle' }
    | { status: 'processing'; stage: string; progress: number }
    | { status: 'error'; message: string }
  >({ status: 'idle' });
  const permission = fixture ? fixture.permission : nativePermission;
  const fixtureNow = fixture ? () => (fixture.observations?.at(-1)?.at ?? 0) + 100 : undefined;

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
      void cleanupCoverFiles(localFiles.current, (uri, options) =>
        Platform.OS === 'web' ? Promise.resolve() : FileSystem.deleteAsync(uri, options),
      );
    };
  }, []);

  const captureCover = useCallback(
    async (preview?: PreviewFrame) => {
      if (coverState.status === 'processing') return;
      setCapturePreview(undefined);
      setCaptureFrame(preview);
      setLiftComplete(false);
      setRecognized(undefined);
      const operation = ++operationGeneration.current;
      const operationIsCurrent = () => mounted.current && operationGeneration.current === operation;
      setCoverState({
        status: 'processing',
        stage: 'Reading the cover…',
        progress: 0,
      });
      if (fixture) {
        await new Promise((resolve) => setTimeout(resolve, fixture.coverDelayMs ?? 0));
        if (!operationIsCurrent()) return;
        if (fixture.coverResult) {
          if (
            fixture.coverResult.status === 'no_match' ||
            fixture.coverResult.candidates.length === 0
          ) {
            setCoverState({
              status: 'error',
              message: 'This cover did not have enough readable detail to identify the book.',
            });
          } else {
            setRecognized({ result: fixture.coverResult });
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
      let previewData: string | undefined;
      try {
        const photo = await camera.current?.takePictureAsync({
          quality: 1,
          skipProcessing: false,
        });
        if (photo) {
          originalUri = photo.uri;
          localFiles.current.push(originalUri);
        }
        if (!operationIsCurrent()) throw new Error('Cover recognition cancelled');
        if (!photo) throw new Error('The camera did not capture a cover.');
        setCoverState({
          status: 'processing',
          stage: 'Preparing the cover…',
          progress: 0.1,
        });
        const prepared = await prepareCoverPhoto(
          photo,
          async (uri, actions, options) => {
            const result = await manipulateAsync(uri, actions, {
              compress: options.compress,
              format: SaveFormat.JPEG,
              base64: true,
            });
            if (result.base64) {
              previewData = `data:image/jpeg;base64,${result.base64}`;
              if (operationIsCurrent()) setCapturePreview(previewData);
            }
            return result;
          },
          preview,
        );
        preparedUri = prepared.uri;
        localFiles.current.push(preparedUri);
        if (!operationIsCurrent()) throw new Error('Cover recognition cancelled');
        if (!coverClient) throw new Error('Cover recognition is unavailable.');
        uploadController = new AbortController();
        abort.current = uploadController;
        setCoverState({
          status: 'processing',
          stage: 'Checking book records…',
          progress: 0.2,
        });
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
          setRecognized({ result, preview: previewData });
        }
      } catch (error) {
        if (!operationIsCurrent()) return;
        const message =
          error instanceof Error ? error.message : 'Cover recognition is unavailable.';
        if (message !== 'Cover recognition cancelled') {
          setCoverState({ status: 'error', message });
        } else {
          setCoverState({ status: 'idle' });
        }
      } finally {
        if (abort.current === uploadController) {
          abort.current = null;
        }
        await cleanupCoverFiles([originalUri, preparedUri], (uri, options) =>
          Platform.OS === 'web' ? Promise.resolve() : FileSystem.deleteAsync(uri, options),
        );
        localFiles.current = localFiles.current.filter(
          (uri) => uri !== originalUri && uri !== preparedUri,
        );
      }
    },
    [coverClient, coverState.status, fixture, onCoverRecognized],
  );

  const processing =
    coverState.status === 'processing' ? (
      <ScanningCover
        uri={capturePreview || fixture?.coverResult?.candidates[0]?.edition.coverUrl}
        title={fixture?.coverResult?.candidates[0]?.work.title ?? 'Your book'}
        author={fixture?.coverResult?.candidates[0]?.work.authors[0]}
        origin={captureFrame}
        ready={!!fixture || !!capturePreview}
        onLiftComplete={() => setLiftComplete(true)}
        onCancel={() => {
          operationGeneration.current += 1;
          abort.current?.abort();
          setRecognized(undefined);
          setLiftComplete(false);
          setCoverState({ status: 'idle' });
        }}
      />
    ) : null;
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
    <View style={{ flex: 1 }}>
      <View
        style={{ flex: 1 }}
        accessibilityElementsHidden={!!processing}
        importantForAccessibility={processing ? 'no-hide-descendants' : 'auto'}
        pointerEvents={processing ? 'none' : 'auto'}
      >
        <ScannerView
          busy={coverState.status === 'processing'}
          previewBook={
            fixture?.coverResult?.candidates[0]
              ? {
                  title: fixture.coverResult.candidates[0].work.title,
                  author: fixture.coverResult.candidates[0].work.authors[0],
                  uri: fixture.coverResult.candidates[0].edition.coverUrl,
                }
              : undefined
          }
          permission={permission}
          scriptedObservations={fixture?.observations}
          feedback={fixture ? noFeedback : undefined}
          onBack={onBack}
          onCaptureCover={(frame) => void captureCover(frame)}
          onIsbnAccepted={(isbn) => {
            if (coverState.status === 'idle') onIsbnAccepted(isbn);
          }}
          onManualSearch={onManualSearch}
          onOpenSettings={() => void Linking.openSettings()}
          onRequestPermission={() => {
            if (!fixture) {
              void requestNativePermission();
            }
          }}
          now={fixtureNow}
          renderCamera={
            fixture
              ? () => (
                  <View
                    accessibilityLabel="Fixture camera preview"
                    style={[
                      styles.fixtureCamera,
                      {
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: '#737571',
                      },
                    ]}
                  ></View>
                )
              : ({ active, onBarcodeScanned }) => (
                  <CameraView
                    active={active}
                    barcodeScannerSettings={{ barcodeTypes: ['ean13'] }}
                    facing="back"
                    onBarcodeScanned={onBarcodeScanned}
                    ref={camera}
                    style={StyleSheet.absoluteFill}
                  />
                )
          }
        />
      </View>
      {processing ? <View style={StyleSheet.absoluteFill}>{processing}</View> : null}
    </View>
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
  previewBook,
  busy = false,
  feedback = successFeedback,
  captureDelayMs = 300,
  now = Date.now,
}: {
  permission: CameraPermissionState | null;
  onBack(): void;
  onCaptureCover(frame?: PreviewFrame): void;
  onIsbnAccepted(isbn: string): void;
  onManualSearch(): void;
  onOpenSettings(): void;
  onRequestPermission(): void;
  renderCamera?: CameraRenderer;
  scriptedObservations?: ScriptedBarcodeObservation[];
  previewBook?: { title: string; author?: string; uri?: string | null };
  busy?: boolean;
  feedback?: () => Promise<void>;
  captureDelayMs?: number;
  now?: () => number;
}) {
  const { width, height } = useWindowDimensions();
  const guideWidth = Math.min(width * 0.64, Math.max(100, ((height - 455) * 2) / 3));
  const frameRef = useRef<React.ComponentRef<typeof View>>(null),
    guideRef = useRef<React.ComponentRef<typeof View>>(null);
  const preview = useRef<PreviewFrame | undefined>(undefined);
  const measureGuide = () => {
    frameRef.current?.measureInWindow((x, y, width, height) =>
      guideRef.current?.measureInWindow((gx, gy, gw, gh) => {
        if (width && height && gw && gh)
          preview.current = {
            width,
            height,
            guide: { x: gx - x, y: gy - y, width: gw, height: gh },
          };
      }),
    );
  };
  const captureInGuide = () => onCaptureCover(preview.current);
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
    void feedbackHandler.current().catch(() => undefined);
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
        title={
          undetermined
            ? 'Scan a cover or ISBN'
            : permission.canAskAgain
              ? 'Camera access is off'
              : 'Camera access is blocked'
        }
        body={
          undetermined
            ? 'Camera access is used only to recognize a book cover or ISBN barcode.'
            : permission.canAskAgain
              ? 'Allow camera access to scan a barcode, or search manually.'
              : 'Enable camera access in Settings, or search manually.'
        }
        primaryAction={
          canRequest
            ? {
                label: undetermined ? 'Allow camera' : 'Try camera access again',
                onPress: onRequestPermission,
              }
            : { label: 'Open Settings', onPress: onOpenSettings }
        }
        isRecovery={!undetermined}
        onBack={onBack}
        onManualSearch={onManualSearch}
      />
    );
  }

  const onBarcodeScanned = (observation: { type: string; data: string }) => {
    if (!busy) dispatch({ type: 'observed', observation, at: now() });
  };
  const camera = renderCamera ? (
    renderCamera({ active: !scanner.locked, onBarcodeScanned })
  ) : (
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
      <View
        ref={frameRef}
        onLayout={measureGuide}
        collapsable={false}
        style={StyleSheet.absoluteFill}
      >
        {camera}
      </View>
      <View style={styles.scrim} pointerEvents="none" />
      <View style={styles.header}>
        <IconButton name="x" label="Back" dark onPress={onBack} />
        <Entrance>
          <View style={[styles.headerCopy, { maxWidth: width - 126 }]}>
            <Copy weight="semibold" style={styles.title}>
              Scan a book
            </Copy>
            <Text style={styles.hint}>Place the book inside the frame.</Text>
          </View>
        </Entrance>
      </View>
      <Entrance>
        <View
          ref={guideRef}
          onLayout={measureGuide}
          collapsable={false}
          accessible
          accessibilityLabel="Book scan guide"
          style={[styles.scanGuide, { width: guideWidth }]}
        >
          {previewBook ? (
            <View
              pointerEvents="none"
              style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}
            >
              <Cover {...previewBook} width={guideWidth} />
            </View>
          ) : null}
          <View style={[styles.corner, styles.topLeft]} />
          <View style={[styles.corner, styles.topRight]} />
          <View style={[styles.corner, styles.bottomLeft]} />
          <View style={[styles.corner, styles.bottomRight]} />
        </View>
      </Entrance>
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
              captureInGuide();
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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Search manually"
          onPress={onManualSearch}
          style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
        >
          <Copy style={{ color: 'white', fontSize: 15 }}>Search manually</Copy>
        </Pressable>
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
        <Text
          accessibilityLiveRegion="assertive"
          accessibilityRole="alert"
          style={styles.permissionBody}
        >
          {message}
        </Text>
        <Button title="Try another cover" onPress={onScanAgain} />
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
  permissionScreen: { backgroundColor: colors.canvas, flex: 1 },
  permissionContent: {
    flex: 1,
    gap: spacing.lg,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  coverStateContent: {
    flex: 1,
    gap: spacing.lg,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  permissionCopy: { gap: spacing.sm, marginVertical: spacing.sm },
  permissionTitle: {
    color: colors.ink,
    fontSize: type.title,
    fontFamily: fonts.semibold,
  },
  permissionBody: {
    color: colors.mutedInk,
    fontSize: type.body,
    fontFamily: fonts.regular,
    lineHeight: 24,
  },
  primaryAction: {
    alignItems: 'center',
    backgroundColor: colors.evergreen,
    borderRadius: radius.control,
    justifyContent: 'center',
    minHeight: 56,
    paddingHorizontal: spacing.xl,
  },
  primaryActionText: { color: '#FFFFFF', fontSize: 17, fontWeight: '600' },
  scannerScreen: {
    backgroundColor: colors.scannerBase,
    flex: 1,
    overflow: 'hidden',
  },
  fixtureCamera: { backgroundColor: colors.scannerBase, flex: 1 },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(4, 10, 7, 0.3)' },
  header: {
    backgroundColor: 'transparent',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingBottom: 26,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
  },
  headerCopy: { gap: 3 },
  title: { color: '#FFFFFF', fontSize: 19, lineHeight: 25 },
  hint: {
    color: colors.evergreenSoft,
    fontSize: type.metadata,
    lineHeight: 20,
  },
  scanGuide: {
    alignSelf: 'center',
    aspectRatio: 2 / 3,
    borderColor: 'rgba(246, 243, 236, 0.18)',
    borderRadius: radius.card,
    borderWidth: 1,
    marginVertical: 24,
    maxHeight: 420,
    width: '64%',
  },
  corner: {
    borderColor: colors.canvas,
    height: 38,
    position: 'absolute',
    width: 38,
  },
  topLeft: { borderLeftWidth: 3, borderTopWidth: 3, left: 0, top: 0 },
  topRight: { borderRightWidth: 3, borderTopWidth: 3, right: 0, top: 0 },
  bottomLeft: { borderBottomWidth: 3, borderLeftWidth: 3, bottom: 0, left: 0 },
  bottomRight: {
    borderBottomWidth: 3,
    borderRightWidth: 3,
    bottom: 0,
    right: 0,
  },
  controls: {
    marginTop: 'auto',
    backgroundColor: 'rgba(12, 18, 18, 0.55)',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    borderTopColor: 'rgba(246, 243, 236, 0.12)',
    borderTopWidth: 1,
    gap: spacing.md,
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
  },
  message: {
    color: '#FFFFFF',
    fontSize: 15,
    minHeight: 20,
    textAlign: 'center',
  },
  shutterOuter: {
    alignItems: 'center',
    alignSelf: 'center',
    borderColor: '#FFFFFF',
    borderRadius: radius.pill,
    borderWidth: 2,
    height: 72,
    justifyContent: 'center',
    width: 72,
  },
  shutterInner: {
    backgroundColor: '#FFFFFF',
    borderRadius: radius.pill,
    height: 58,
    width: 58,
  },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.45 },
  progressTrack: {
    backgroundColor: colors.line,
    borderRadius: 3,
    height: 6,
    overflow: 'hidden',
  },
  progressFill: {
    backgroundColor: colors.evergreen,
    borderRadius: 3,
    height: 6,
  },
});
