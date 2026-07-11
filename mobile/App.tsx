import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';

import { createBackendClient, type BackendClient } from './src/api/health';
import type { CoverClient, CoverRecognitionResult } from './src/api/cover';
import { createExpoCoverClient } from './src/api/coverRuntime';
import {
  createEditionClient,
  requestForCandidate,
  type EditionClient,
} from './src/api/editions';
import {
  EpubDeliveryError,
  type DownloadedEpub,
  type EpubDeliveryClient,
  type EpubDownloadTask,
} from './src/api/epubDelivery';
import { createExpoEpubDeliveryClient } from './src/api/epubDeliveryRuntime';
import {
  createMetadataClient,
  type MetadataClient,
  type MetadataQuery,
} from './src/api/metadata';
import { resolveEnvironment } from './src/config/environment';
import { ScenarioLauncher } from './src/dev/ScenarioLauncher';
import { ManualSearchFlow } from './src/screens/ManualSearchFlow';
import { EditionResolutionFlow } from './src/screens/EditionResolutionFlow';
import { ScannerScreen, type ScannerFixture } from './src/scanner/ScannerScreen';
import { appReducer, initialAppState } from './src/state/appState';
import { initialSearchState, searchReducer } from './src/state/searchState';
import { editionReducer, initialEditionState } from './src/state/editionState';
import {
  exportReducer,
  initialExportState,
  type ExportIntent,
} from './src/state/exportState';
import {
  PrimaryButton,
  SecondaryButton,
  StatusMessage,
} from './src/ui/primitives';
import { Entrance } from './src/ui/Entrance';
import { colors, radius, spacing, type } from './src/ui/theme';
import { useReducedMotionStatus } from './src/ui/useReducedMotion';

export type AppProps = {
  client?: BackendClient;
  metadataClient?: MetadataClient;
  coverClient?: CoverClient;
  editionClient?: EditionClient;
  epubDeliveryClient?: EpubDeliveryClient;
  showScenarioLauncher?: boolean;
};

const environment = resolveEnvironment({
  EXPO_PUBLIC_APP_ENV: process.env.EXPO_PUBLIC_APP_ENV,
  EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
});

const liveClient = createBackendClient({
  baseUrl: environment.apiUrl,
  fetcher: fetch,
  timeoutMs: 5000,
});

const liveMetadataClient = createMetadataClient({
  baseUrl: environment.apiUrl,
  fetcher: fetch,
  timeoutMs: 8000,
});

const liveCoverClient = createExpoCoverClient(environment.apiUrl);
const liveEditionClient = createEditionClient({
  baseUrl: environment.apiUrl,
  fetcher: fetch,
  timeoutMs: 35_000,
});
let liveEpubDeliveryClient: EpubDeliveryClient | null = null;

function getLiveEpubDeliveryClient(): EpubDeliveryClient {
  liveEpubDeliveryClient ??= createExpoEpubDeliveryClient(environment.apiUrl);
  return liveEpubDeliveryClient;
}

const deferredEpubDeliveryClient: EpubDeliveryClient = {
  createDownload(delivery, onProgress) {
    return getLiveEpubDeliveryClient().createDownload(delivery, onProgress);
  },
  shareEpub(uri) {
    return getLiveEpubDeliveryClient().shareEpub(uri);
  },
  cleanup(uri) {
    return getLiveEpubDeliveryClient().cleanup(uri);
  },
};

export default function App({
  client = liveClient,
  metadataClient = liveMetadataClient,
  coverClient = liveCoverClient,
  editionClient = liveEditionClient,
  epubDeliveryClient = deferredEpubDeliveryClient,
  showScenarioLauncher = __DEV__,
}: AppProps) {
  useReducedMotionStatus();
  const [state, dispatch] = useReducer(appReducer, initialAppState);
  const [searchState, dispatchSearch] = useReducer(searchReducer, initialSearchState);
  const [editionState, dispatchEdition] = useReducer(editionReducer, initialEditionState);
  const [exportState, dispatchExport] = useReducer(exportReducer, initialExportState);
  const searchGeneration = useRef(0);
  const lastQuery = useRef<MetadataQuery | null>(null);
  const activeSearch = useRef<AbortController | null>(null);
  const activeEdition = useRef<AbortController | null>(null);
  const activeDownload = useRef<EpubDownloadTask | null>(null);
  const selectedCandidate = useRef<import('./src/api/metadata').MetadataCandidate | null>(null);
  const [scannerFixture, setScannerFixture] = useState<ScannerFixture | undefined>();
  const [identificationOrigin, setIdentificationOrigin] = useState<'manual' | 'isbn' | 'cover'>('manual');
  const [coverConfidence, setCoverConfidence] = useState<'high' | 'medium' | 'low'>('low');

  const checkHealth = useCallback(async () => {
    dispatch({ type: 'healthChecking' });
    try {
      await client.checkHealth();
      dispatch({ type: 'healthSucceeded' });
    } catch (error) {
      dispatch({
        type: 'healthFailed',
        message: error instanceof Error ? error.message : 'Backend unavailable',
      });
    }
  }, [client]);

  const search = useCallback(async (query: MetadataQuery) => {
    lastQuery.current = query;
    const generation = ++searchGeneration.current;
    activeSearch.current?.abort();
    const controller = new AbortController();
    activeSearch.current = controller;
    dispatchSearch({ type: 'started' });
    try {
      const result = await metadataClient.search(query, controller.signal);
      if (generation !== searchGeneration.current) {
        return;
      }
      dispatchSearch({
        type: 'succeeded',
        candidates: result.candidates,
        providerFailures: result.providerFailures,
      });
    } catch (error) {
      if (generation !== searchGeneration.current) {
        return;
      }
      dispatchSearch({
        type: 'failed',
        message: error instanceof Error ? error.message : 'Book search is unavailable',
      });
    } finally {
      if (activeSearch.current === controller) {
        activeSearch.current = null;
      }
    }
  }, [metadataClient]);

  const cancelSearch = useCallback(() => {
    searchGeneration.current += 1;
    activeSearch.current?.abort();
    activeSearch.current = null;
    dispatchSearch({ type: 'reset' });
  }, []);

  const retrySearch = useCallback(() => {
    if (lastQuery.current) {
      void search(lastQuery.current);
    }
  }, [search]);

  const resolveEdition = useCallback(async (candidate: import('./src/api/metadata').MetadataCandidate) => {
    activeEdition.current?.abort();
    const controller = new AbortController();
    activeEdition.current = controller;
    selectedCandidate.current = candidate;
    dispatchEdition({ type: 'started' });
    dispatchExport({ type: 'reset' });
    dispatch({ type: 'showEdition' });
    try {
      const result = await editionClient.resolve(requestForCandidate(candidate), controller.signal);
      if (activeEdition.current !== controller) return;
      dispatchEdition({ type: 'succeeded', result });
    } catch (error) {
      if (activeEdition.current !== controller) return;
      dispatchEdition({ type: 'failed', message: error instanceof Error ? error.message : 'Open-edition check failed' });
    } finally {
      if (activeEdition.current === controller) activeEdition.current = null;
    }
  }, [editionClient]);

  const cleanupLocalEpub = useCallback(async () => {
    const file = exportState.file;
    if (file) {
      await epubDeliveryClient.cleanup(file.uri).catch(() => undefined);
    }
    dispatchExport({ type: 'reset' });
  }, [epubDeliveryClient, exportState.file]);

  const showEpubShareSheet = useCallback(async (file: DownloadedEpub, _intent: ExportIntent) => {
    dispatchExport({ type: 'sharing' });
    try {
      await epubDeliveryClient.shareEpub(file.uri);
      dispatchExport({ type: 'shareFinished' });
    } catch (error) {
      const deliveryError = error instanceof EpubDeliveryError
        ? error
        : new EpubDeliveryError('download', 'The EPUB could not be shared.');
      dispatchExport({
        type: 'failed',
        code: deliveryError.code,
        message: deliveryError.message,
        file,
      });
    }
  }, [epubDeliveryClient]);

  const exportEpub = useCallback(async (intent: ExportIntent) => {
    const result = editionState.result;
    if (result?.status !== 'ready' || !result.delivery) return;
    if (exportState.file) {
      await showEpubShareSheet(exportState.file, intent);
      return;
    }
    dispatchExport({ type: 'downloadStarted', intent });
    let task: EpubDownloadTask;
    try {
      task = epubDeliveryClient.createDownload(result.delivery, (progress) => {
        dispatchExport({ type: 'progressed', progress });
      });
    } catch (error) {
      const deliveryError = error instanceof EpubDeliveryError
        ? error
        : new EpubDeliveryError('download', 'Temporary file storage is unavailable.');
      dispatchExport({ type: 'failed', code: deliveryError.code, message: deliveryError.message });
      return;
    }
    activeDownload.current = task;
    try {
      const file = await task.start();
      if (activeDownload.current !== task) {
        await epubDeliveryClient.cleanup(file.uri).catch(() => undefined);
        return;
      }
      dispatchExport({ type: 'downloaded', file });
      await showEpubShareSheet(file, intent);
    } catch (error) {
      if (activeDownload.current !== task) return;
      const deliveryError = error instanceof EpubDeliveryError
        ? error
        : new EpubDeliveryError('download', 'The verified EPUB could not be downloaded.');
      dispatchExport({ type: 'failed', code: deliveryError.code, message: deliveryError.message });
    } finally {
      if (activeDownload.current === task) activeDownload.current = null;
    }
  }, [editionState.result, epubDeliveryClient, exportState.file, showEpubShareSheet]);

  const cancelEpubExport = useCallback(() => {
    void activeDownload.current?.cancel();
  }, []);

  useEffect(() => {
    void checkHealth();
  }, [checkHealth]);

  if (state.screen === 'scanner') {
    return (
      <ScannerScreen
        coverClient={coverClient}
        fixture={scannerFixture}
        onBack={() => {
          setScannerFixture(undefined);
          dispatch({ type: 'showLaunch' });
        }}
        onCoverRecognized={(result: CoverRecognitionResult) => {
          setScannerFixture(undefined);
          setIdentificationOrigin('cover');
          setCoverConfidence(result.confidence);
          dispatchSearch({
            type: 'succeeded',
            candidates: result.candidates,
            providerFailures: result.providerFailures,
          });
          dispatch({ type: 'showManualSearch' });
        }}
        onIsbnAccepted={(isbn) => {
          setScannerFixture(undefined);
          setIdentificationOrigin('isbn');
          dispatch({ type: 'showManualSearch' });
          void search({ isbn });
        }}
        onManualSearch={() => {
          setScannerFixture(undefined);
          setIdentificationOrigin('manual');
          dispatchSearch({ type: 'reset' });
          dispatch({ type: 'showManualSearch' });
        }}
      />
    );
  }

  if (state.screen === 'manualSearch') {
    return (
      <ManualSearchFlow
        state={searchState}
        onBack={() => dispatch({ type: 'showScanner' })}
        onCancel={cancelSearch}
        onConfirm={(candidate) => {
          dispatchSearch({ type: 'confirmed', candidate });
          void resolveEdition(candidate);
        }}
        onEdit={() => {
          if (identificationOrigin === 'cover') {
            cancelSearch();
            dispatch({ type: 'showScanner' });
          } else {
            cancelSearch();
          }
        }}
        onRetry={retrySearch}
        onSearch={(query) => void search(query)}
        origin={identificationOrigin}
        recognitionConfidence={identificationOrigin === 'cover' ? coverConfidence : undefined}
      />
    );
  }

  if (state.screen === 'edition' && selectedCandidate.current) {
    return (
      <EditionResolutionFlow
        candidate={selectedCandidate.current}
        state={editionState}
        onBack={() => {
          activeEdition.current?.abort();
          activeEdition.current = null;
          dispatch({ type: 'showManualSearch' });
        }}
        onRetry={() => {
          if (selectedCandidate.current) void resolveEdition(selectedCandidate.current);
        }}
        onScanAnother={() => {
          activeEdition.current?.abort();
          activeEdition.current = null;
          void cleanupLocalEpub();
          selectedCandidate.current = null;
          dispatchEdition({ type: 'reset' });
          dispatchSearch({ type: 'reset' });
          dispatch({ type: 'showScanner' });
        }}
        exportState={exportState}
        onExport={(intent) => void exportEpub(intent)}
        onCancelExport={cancelEpubExport}
        onRetryExport={() => {
          if (exportState.intent) void exportEpub(exportState.intent);
        }}
        onRefreshEdition={() => {
          if (selectedCandidate.current) void resolveEdition(selectedCandidate.current);
        }}
      />
    );
  }

  if (state.screen === 'scenarios') {
    return (
      <ScenarioLauncher
        onBack={() => dispatch({ type: 'showLaunch' })}
        onCandidates={(candidates, providerFailures = []) => {
          dispatchSearch({ type: 'succeeded', candidates, providerFailures });
          dispatch({ type: 'showManualSearch' });
        }}
        onConnected={() => dispatch({ type: 'healthSucceeded' })}
        onLoading={() => {
          dispatch({ type: 'healthChecking' });
          dispatch({ type: 'showLaunch' });
        }}
        onOffline={() => dispatch({ type: 'healthFailed', message: 'Backend unavailable' })}
        onSearchError={(retryQuery) => {
          lastQuery.current = retryQuery;
          dispatchSearch({ type: 'failed', message: 'Book search is temporarily unavailable' });
          dispatch({ type: 'showManualSearch' });
        }}
        onScannerFixture={(fixture) => {
          setScannerFixture(fixture);
          dispatch({ type: 'showScanner' });
        }}
        onTimeout={() => dispatch({ type: 'healthFailed', message: 'Connection timed out' })}
        onEditionResult={(candidate, result) => {
          selectedCandidate.current = candidate;
          dispatchSearch({ type: 'confirmed', candidate });
          dispatchEdition({ type: 'succeeded', result });
          dispatch({ type: 'showEdition' });
        }}
        onEditionError={(candidate, message) => {
          selectedCandidate.current = candidate;
          dispatchSearch({ type: 'confirmed', candidate });
          dispatchEdition({ type: 'failed', message });
          dispatch({ type: 'showEdition' });
        }}
        onResolveEdition={(candidate) => void resolveEdition(candidate)}
      />
    );
  }

  const statusTone = state.connectivity === 'online'
    ? 'success'
    : state.connectivity === 'offline'
      ? 'error'
      : 'neutral';

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      <View style={styles.content}>
        <Entrance>
          <View style={styles.launchStack}>
            <View style={styles.launchCopy}>
              <Text style={styles.eyebrow}>RIGHTS-AWARE READING</Text>
              <Text style={styles.title}>Book to EPUB</Text>
              <Text style={styles.body}>
                Identify a physical book and find a verified open edition.
              </Text>
            </View>
            <View style={styles.connectionRow}>
              <StatusMessage tone={statusTone} text={state.message} />
            </View>
            <View style={styles.buttonStack}>
              <PrimaryButton
                label="Open scanner"
                onPress={() => {
                  setScannerFixture(undefined);
                  dispatch({ type: 'showScanner' });
                }}
              />
              {state.connectivity === 'offline' ? (
                <SecondaryButton label="Retry connection" onPress={() => void checkHealth()} />
              ) : null}
              {showScenarioLauncher ? (
                <SecondaryButton
                  label="Test scenarios"
                  onPress={() => dispatch({ type: 'showScenarios' })}
                />
              ) : null}
            </View>
          </View>
        </Entrance>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.canvas, flex: 1 },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
  },
  launchStack: { gap: spacing.xl },
  launchCopy: { gap: spacing.md },
  eyebrow: {
    color: colors.evergreen,
    fontSize: type.eyebrow,
    fontWeight: '700',
    letterSpacing: 1.6,
  },
  title: {
    color: colors.ink,
    fontSize: type.display,
    fontWeight: '700',
    letterSpacing: -1.2,
    lineHeight: 46,
  },
  body: { color: colors.mutedInk, fontSize: type.body, lineHeight: 25, maxWidth: 340 },
  connectionRow: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  buttonStack: { gap: spacing.md, marginTop: spacing.sm },
});
