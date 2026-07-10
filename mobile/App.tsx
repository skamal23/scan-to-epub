import { useCallback, useEffect, useReducer, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';

import { createBackendClient, type BackendClient } from './src/api/health';
import {
  createMetadataClient,
  type MetadataClient,
  type MetadataQuery,
} from './src/api/metadata';
import { resolveEnvironment } from './src/config/environment';
import { ScenarioLauncher } from './src/dev/ScenarioLauncher';
import { ManualSearchFlow } from './src/screens/ManualSearchFlow';
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

export default function App({
  client = liveClient,
  metadataClient = liveMetadataClient,
  showScenarioLauncher = __DEV__,
}: AppProps) {
  const [state, dispatch] = useReducer(appReducer, initialAppState);
  const [searchState, dispatchSearch] = useReducer(searchReducer, initialSearchState);
  const searchGeneration = useRef(0);
  const lastQuery = useRef<MetadataQuery | null>(null);
  const activeSearch = useRef<AbortController | null>(null);

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
      <SafeAreaView style={styles.scannerScreen}>
        <StatusBar style="light" />
        <View style={styles.scannerHeader}>
          <SecondaryButton
            appearance="onDark"
            compact
            label="Back"
            onPress={() => dispatch({ type: 'showLaunch' })}
          />
          <Text style={styles.scannerTitle}>Scan a cover or ISBN</Text>
          <Text style={styles.scannerHint}>Camera support arrives in Phase 2.</Text>
        </View>
        <View
          accessible
          accessibilityLabel="Book scan guide"
          style={styles.scanGuide}
        >
          <View style={[styles.corner, styles.topLeft]} />
          <View style={[styles.corner, styles.topRight]} />
          <View style={[styles.corner, styles.bottomLeft]} />
          <View style={[styles.corner, styles.bottomRight]} />
        </View>
        <View style={styles.scannerActions}>
          <SecondaryButton
            appearance="onDark"
            label="Search manually"
            onPress={() => {
              dispatchSearch({ type: 'reset' });
              dispatch({ type: 'showManualSearch' });
            }}
          />
        </View>
      </SafeAreaView>
    );
  }

  if (state.screen === 'manualSearch') {
    return (
      <ManualSearchFlow
        state={searchState}
        onBack={() => dispatch({ type: 'showScanner' })}
        onCancel={cancelSearch}
        onConfirm={(candidate) => dispatchSearch({ type: 'confirmed', candidate })}
        onEdit={cancelSearch}
        onRetry={retrySearch}
        onSearch={(query) => void search(query)}
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
          <PrimaryButton label="Open scanner" onPress={() => dispatch({ type: 'showScanner' })} />
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
  scannerScreen: { backgroundColor: '#111713', flex: 1 },
  scannerHeader: { gap: 12, padding: 24 },
  scannerTitle: { color: '#FFFFFF', fontSize: 24, fontWeight: '600' },
  scannerHint: { color: '#A9B1AC', fontSize: 15 },
  scanGuide: { alignSelf: 'center', flex: 1, marginBottom: 52, width: '78%' },
  scannerActions: { paddingHorizontal: 24, paddingBottom: 16 },
  corner: { borderColor: '#EDE8DC', height: 42, position: 'absolute', width: 42 },
  topLeft: { borderLeftWidth: 3, borderTopWidth: 3, left: 0, top: 0 },
  topRight: { borderRightWidth: 3, borderTopWidth: 3, right: 0, top: 0 },
  bottomLeft: { borderBottomWidth: 3, borderLeftWidth: 3, bottom: 0, left: 0 },
  bottomRight: { borderBottomWidth: 3, borderRightWidth: 3, bottom: 0, right: 0 },
});
