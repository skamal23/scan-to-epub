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
  createMetadataClient,
  type MetadataClient,
  type MetadataQuery,
} from './src/api/metadata';
import { resolveEnvironment } from './src/config/environment';
import { ScenarioLauncher } from './src/dev/ScenarioLauncher';
import { ManualSearchFlow } from './src/screens/ManualSearchFlow';
import { ScannerScreen, type ScannerFixture } from './src/scanner/ScannerScreen';
import { appReducer, initialAppState } from './src/state/appState';
import { initialSearchState, searchReducer } from './src/state/searchState';
import {
  PrimaryButton,
  SecondaryButton,
  StatusMessage,
} from './src/ui/primitives';

export type AppProps = {
  client?: BackendClient;
  metadataClient?: MetadataClient;
  coverClient?: CoverClient;
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

export default function App({
  client = liveClient,
  metadataClient = liveMetadataClient,
  coverClient = liveCoverClient,
  showScenarioLauncher = __DEV__,
}: AppProps) {
  const [state, dispatch] = useReducer(appReducer, initialAppState);
  const [searchState, dispatchSearch] = useReducer(searchReducer, initialSearchState);
  const searchGeneration = useRef(0);
  const lastQuery = useRef<MetadataQuery | null>(null);
  const activeSearch = useRef<AbortController | null>(null);
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
        onConfirm={(candidate) => dispatchSearch({ type: 'confirmed', candidate })}
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
        <Text style={styles.eyebrow}>RIGHTS-AWARE READING</Text>
        <Text style={styles.title}>Book to EPUB</Text>
        <Text style={styles.body}>
          Identify a physical book and find a verified open edition.
        </Text>
        <StatusMessage tone={statusTone} text={state.message} />
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: '#F4F1EA', flex: 1 },
  content: { flex: 1, gap: 20, justifyContent: 'center', padding: 28 },
  eyebrow: { color: '#68756D', fontSize: 12, fontWeight: '700', letterSpacing: 1.4 },
  title: { color: '#1D241F', fontSize: 40, fontWeight: '700', letterSpacing: -1.2 },
  body: { color: '#575750', fontSize: 18, lineHeight: 26, maxWidth: 330 },
  buttonStack: { gap: 12, marginTop: 12 },
});
