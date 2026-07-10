import { useCallback, useEffect, useReducer } from 'react';
import {
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';

import { createBackendClient, type BackendClient } from './src/api/health';
import { resolveEnvironment } from './src/config/environment';
import { appReducer, initialAppState } from './src/state/appState';
import {
  PrimaryButton,
  SecondaryButton,
  StatusMessage,
} from './src/ui/primitives';

export type AppProps = {
  client?: BackendClient;
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

export default function App({
  client = liveClient,
  showScenarioLauncher = __DEV__,
}: AppProps) {
  const [state, dispatch] = useReducer(appReducer, initialAppState);

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
      </SafeAreaView>
    );
  }

  if (state.screen === 'scenarios') {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="dark" />
        <View style={styles.content}>
          <Text style={styles.eyebrow}>DEVELOPMENT ONLY</Text>
          <Text style={styles.title}>Scenario launcher</Text>
          <Text style={styles.body}>Reach deterministic app states without external services.</Text>
          <View style={styles.buttonStack}>
            <PrimaryButton label="Connected" onPress={() => dispatch({ type: 'healthSucceeded' })} />
            <SecondaryButton
              label="Loading"
              onPress={() => {
                dispatch({ type: 'healthChecking' });
                dispatch({ type: 'showLaunch' });
              }}
            />
            <SecondaryButton
              label="Offline"
              onPress={() => dispatch({ type: 'healthFailed', message: 'Backend unavailable' })}
            />
            <SecondaryButton
              label="Timeout"
              onPress={() => dispatch({ type: 'healthFailed', message: 'Connection timed out' })}
            />
            <SecondaryButton label="Back" onPress={() => dispatch({ type: 'showLaunch' })} />
          </View>
        </View>
      </SafeAreaView>
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
  corner: { borderColor: '#EDE8DC', height: 42, position: 'absolute', width: 42 },
  topLeft: { borderLeftWidth: 3, borderTopWidth: 3, left: 0, top: 0 },
  topRight: { borderRightWidth: 3, borderTopWidth: 3, right: 0, top: 0 },
  bottomLeft: { borderBottomWidth: 3, borderLeftWidth: 3, bottom: 0, left: 0 },
  bottomRight: { borderBottomWidth: 3, borderRightWidth: 3, bottom: 0, right: 0 },
});
