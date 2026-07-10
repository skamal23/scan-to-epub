import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { MetadataCandidate } from '../api/metadata';
import type { EditionState } from '../state/editionState';
import { PrimaryButton, SecondaryButton } from '../ui/primitives';


export function EditionResolutionFlow({
  candidate,
  state,
  onBack,
  onRetry,
  onScanAnother,
}: {
  candidate: MetadataCandidate;
  state: EditionState;
  onBack(): void;
  onRetry(): void;
  onScanAnother(): void;
}) {
  if (state.status === 'searching' || state.status === 'idle') {
    return <Searching candidate={candidate} onBack={onBack} />;
  }
  if (state.status === 'error') {
    return (
      <MessageScreen
        title="Open-edition check unavailable"
        body={state.message ?? 'Please try the approved source again.'}
        primary={{ label: 'Try source check again', onPress: onRetry }}
        secondary={{ label: 'Back to book', onPress: onBack }}
      />
    );
  }
  if (!state.result || state.result.status === 'unavailable') {
    return (
      <MessageScreen
        title="Book identified, open edition unavailable"
        body={state.result?.reason ?? 'No reviewed open edition is available for this work yet.'}
        primary={{ label: 'Scan another book', onPress: onScanAnother }}
        secondary={{ label: 'Back to book', onPress: onBack }}
      />
    );
  }
  if (!state.result.digitalEdition || !state.result.source || !state.result.rights || !state.result.provenance) {
    return (
      <MessageScreen
        title="Open-edition check unavailable"
        body="The result was incomplete. Please try again."
        primary={{ label: 'Try source check again', onPress: onRetry }}
        secondary={{ label: 'Back to book', onPress: onBack }}
      />
    );
  }
  return <Ready result={state.result} onScanAnother={onScanAnother} />;
}

function Searching({ candidate, onBack }: { candidate: MetadataCandidate; onBack(): void }) {
  const physical = [candidate.edition.publisher, candidate.edition.publishedDate].filter(Boolean).join(', ');
  return (
    <SafeAreaView style={styles.screen}>
      <View style={[styles.content, styles.centered]}>
        <Text style={styles.eyebrow}>WORK CONFIRMED</Text>
        <Text style={styles.title}>Work confirmed</Text>
        <Text style={styles.subtitle}>Checking reviewed open editions…</Text>
        <Text style={styles.body}>Validating rights, source integrity, and EPUB conformance.</Text>
        <View style={styles.infoBox}>
          <Text style={styles.infoTitle}>Your physical edition</Text>
          <Text style={styles.infoBody}>{physical || 'Edition details unavailable'}</Text>
          <Text style={styles.infoBody}>The open digital edition may differ from your physical edition.</Text>
        </View>
        <SecondaryButton label="Cancel source check" onPress={onBack} />
      </View>
    </SafeAreaView>
  );
}

function Ready({ result, onScanAnother }: { result: NonNullable<EditionState['result']>; onScanAnother(): void }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const digital = result.digitalEdition!;
  const source = result.source!;
  const rights = result.rights!;
  const provenance = result.provenance!;
  const physical = result.physicalEdition;
  const physicalPublication = [physical?.publisher, physical?.publishedDate].filter(Boolean).join(', ');
  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.eyebrow}>VERIFIED OPEN EDITION</Text>
        <Text style={styles.title}>Verified open edition</Text>
        <View style={styles.editionCard}>
          <Image source={{ uri: digital.coverUrl }} style={styles.cover} />
          <View style={styles.editionCopy}>
            <Text style={styles.editionTitle}>{digital.title}</Text>
            <Text style={styles.editionAuthor}>{digital.authors.join(', ')}</Text>
            <Text style={styles.source}>{source.organization}</Text>
          </View>
        </View>
        <Text style={styles.body}>
          A legal open edition of this work is available. Its cover, introduction, notes, formatting, or pagination may differ from your physical copy.
        </Text>
        <View style={styles.infoBox}>
          <Text style={styles.infoTitle}>Work confirmed</Text>
          <Text style={styles.infoTitle}>Your physical edition</Text>
          <Text style={styles.infoBody}>{physicalPublication || 'Edition details unavailable'}</Text>
          <Text style={styles.infoBody}>The open digital edition may differ from your physical edition.</Text>
        </View>
        <DisabledAction label="Open in Books — available next phase" />
        <DisabledAction label="Save to Files — available next phase" />
        <SecondaryButton
          label={detailsOpen ? 'Hide edition details' : 'Why this edition is available'}
          onPress={() => setDetailsOpen((open) => !open)}
        />
        {detailsOpen ? (
          <View style={styles.detailsCard}>
            <Detail label="Source" value={source.organization} />
            <Detail label="License" value={rights.licenseName} />
            <Detail label="Territory" value={rights.territory === 'US' ? 'United States' : rights.territory} />
            <Detail label="File" value="Passed through unchanged" />
            <Detail label="Validation" value={`EPUBCheck ${provenance.epubcheckVersion} · Valid`} />
            <Detail label="Reviewed" value={provenance.catalogReviewedAt} />
            <Text style={styles.hash}>SHA-256 {provenance.finalSha256.slice(0, 12)}…</Text>
            <Text style={styles.detailsBody}>{rights.rightsStatement}</Text>
          </View>
        ) : null}
        <SecondaryButton label="Scan another book" onPress={onScanAnother} />
      </ScrollView>
    </SafeAreaView>
  );
}

function DisabledAction({ label }: { label: string }) {
  return (
    <Pressable accessibilityLabel={label} accessibilityRole="button" disabled style={styles.disabledAction}>
      <Text style={styles.disabledActionText}>{label}</Text>
    </Pressable>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function MessageScreen({ title, body, primary, secondary }: {
  title: string;
  body: string;
  primary: { label: string; onPress(): void };
  secondary: { label: string; onPress(): void };
}) {
  return (
    <SafeAreaView style={styles.screen}>
      <View style={[styles.content, styles.centered]}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>{body}</Text>
        <PrimaryButton label={primary.label} onPress={primary.onPress} />
        <SecondaryButton label={secondary.label} onPress={secondary.onPress} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: '#F4F1EA', flex: 1 },
  content: { gap: 18, padding: 28, paddingBottom: 48 },
  centered: { flex: 1, justifyContent: 'center' },
  eyebrow: { color: '#52705F', fontSize: 12, fontWeight: '700', letterSpacing: 1.3 },
  title: { color: '#1D241F', fontSize: 34, fontWeight: '700', letterSpacing: -0.8 },
  subtitle: { color: '#1D241F', fontSize: 22, fontWeight: '600' },
  body: { color: '#60605A', fontSize: 17, lineHeight: 25 },
  infoBox: { backgroundColor: '#E8E5DC', borderRadius: 16, gap: 7, padding: 18 },
  infoTitle: { color: '#1D241F', fontSize: 15, fontWeight: '700' },
  infoBody: { color: '#575750', fontSize: 15, lineHeight: 21 },
  editionCard: { backgroundColor: '#FFFFFF', borderRadius: 18, flexDirection: 'row', gap: 18, padding: 16 },
  cover: { backgroundColor: '#DEDCD5', borderRadius: 9, height: 168, width: 112 },
  editionCopy: { flex: 1, gap: 8, justifyContent: 'center' },
  editionTitle: { color: '#1D241F', fontSize: 22, fontWeight: '700' },
  editionAuthor: { color: '#555A56', fontSize: 17 },
  source: { color: '#52705F', fontSize: 14, fontWeight: '700' },
  disabledAction: { alignItems: 'center', backgroundColor: '#DFDDD6', borderRadius: 14, minHeight: 52, justifyContent: 'center', opacity: 0.72, paddingHorizontal: 18 },
  disabledActionText: { color: '#686963', fontSize: 16, fontWeight: '600', textAlign: 'center' },
  detailsCard: { backgroundColor: '#FFFFFF', borderRadius: 16, gap: 12, padding: 18 },
  detailRow: { flexDirection: 'row', gap: 16, justifyContent: 'space-between' },
  detailLabel: { color: '#777871', fontSize: 14 },
  detailValue: { color: '#1D241F', flex: 1, fontSize: 14, fontWeight: '600', textAlign: 'right' },
  hash: { color: '#6B6C66', fontFamily: 'Courier', fontSize: 12 },
  detailsBody: { color: '#60605A', fontSize: 14, lineHeight: 20 },
});
