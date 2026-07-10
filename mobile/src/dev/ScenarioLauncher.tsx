import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { MetadataCandidate, MetadataQuery } from '../api/metadata';
import type { ScannerFixture } from '../scanner/ScannerScreen';
import { PrimaryButton, SecondaryButton } from '../ui/primitives';
import { metadataScenarios } from './metadataScenarios';
import { scannerFixtures } from './scannerFixtures';

export function ScenarioLauncher({
  onBack,
  onCandidates,
  onConnected,
  onLoading,
  onOffline,
  onSearchError,
  onScannerFixture,
  onTimeout,
}: {
  onBack(): void;
  onCandidates(candidates: MetadataCandidate[], providerFailures?: string[]): void;
  onConnected(): void;
  onLoading(): void;
  onOffline(): void;
  onSearchError(retryQuery: MetadataQuery): void;
  onScannerFixture(fixture: ScannerFixture): void;
  onTimeout(): void;
}) {
  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      <ScrollView key="scenario-scroll" contentContainerStyle={styles.content}>
        <Text style={styles.eyebrow}>DEVELOPMENT ONLY</Text>
        <Text style={styles.title}>Scenario launcher</Text>
        <Text style={styles.body}>Reach deterministic app states without external services.</Text>
        <Text style={styles.sectionLabel}>CONNECTION</Text>
        <View style={styles.buttonStack}>
          <PrimaryButton label="Connected" onPress={onConnected} />
          <SecondaryButton label="Loading" onPress={onLoading} />
          <SecondaryButton label="Offline" onPress={onOffline} />
          <SecondaryButton label="Timeout" onPress={onTimeout} />
        </View>
        <Text style={styles.sectionLabel}>ISBN SCANNER</Text>
        <View style={styles.buttonStack}>
          <SecondaryButton
            label="Camera permission prompt"
            onPress={() => onScannerFixture(scannerFixtures.permissionPrompt)}
          />
          <SecondaryButton
            label="Camera permission denied"
            onPress={() => onScannerFixture(scannerFixtures.permissionDenied)}
          />
          <SecondaryButton
            label="Camera permission blocked"
            onPress={() => onScannerFixture(scannerFixtures.permissionBlocked)}
          />
          <SecondaryButton
            label="Invalid ISBN"
            onPress={() => onScannerFixture(scannerFixtures.invalid)}
          />
          <SecondaryButton
            label="Unstable ISBN"
            onPress={() => onScannerFixture(scannerFixtures.unstable)}
          />
          <SecondaryButton
            label="Single ISBN"
            onPress={() => onScannerFixture(scannerFixtures.singleValid)}
          />
          <SecondaryButton
            label="Repeated ISBN"
            onPress={() => onScannerFixture(scannerFixtures.repeatedValid)}
          />
        </View>
        <Text style={styles.sectionLabel}>BOOK SEARCH</Text>
        <View style={styles.buttonStack}>
          <SecondaryButton label="One book" onPress={() => onCandidates(metadataScenarios.one)} />
          <SecondaryButton
            label="Ambiguous books"
            onPress={() => onCandidates(metadataScenarios.ambiguous)}
          />
          <SecondaryButton label="No books" onPress={() => onCandidates([])} />
          <SecondaryButton
            label="Catalog warning"
            onPress={() => onCandidates(metadataScenarios.one, ['open_library'])}
          />
          <SecondaryButton
            label="Search error"
            onPress={() =>
              onSearchError({ title: 'Pride and Prejudice', author: 'Jane Austen' })
            }
          />
          <SecondaryButton
            label="Long title and no cover"
            onPress={() => onCandidates(metadataScenarios.longTitle)}
          />
          <SecondaryButton label="Back" onPress={onBack} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: '#F4F1EA', flex: 1 },
  content: { gap: 16, padding: 28, paddingBottom: 44 },
  eyebrow: { color: '#68756D', fontSize: 12, fontWeight: '700', letterSpacing: 1.4 },
  title: { color: '#1D241F', fontSize: 40, fontWeight: '700', letterSpacing: -1.2 },
  body: { color: '#575750', fontSize: 18, lineHeight: 26, maxWidth: 330 },
  sectionLabel: {
    color: '#68756D',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginTop: 8,
  },
  buttonStack: { gap: 12, marginTop: 12 },
});
