import { useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAccessibilityAnnouncement } from '../accessibility/useAccessibilityAnnouncement';
import type { MetadataCandidate } from '../api/metadata';
import type { EditionState } from '../state/editionState';
import type { ExportIntent, ExportState } from '../state/exportState';
import { Entrance } from '../ui/Entrance';
import { PrimaryButton, SecondaryButton } from '../ui/primitives';
import { colors, motion, radius, spacing, type } from '../ui/theme';

export function EditionResolutionFlow({
  state,
  onBack,
  onRetry,
  onScanAnother,
  exportState,
  onExport,
  onCancelExport,
  onRetryExport,
  onRefreshEdition,
}: {
  candidate: MetadataCandidate;
  state: EditionState;
  onBack(): void;
  onRetry(): void;
  onScanAnother(): void;
  exportState: ExportState;
  onExport(intent: ExportIntent): void;
  onCancelExport(): void;
  onRetryExport(): void;
  onRefreshEdition(): void;
}) {
  useAccessibilityAnnouncement(editionAnnouncement(state, exportState));

  if (state.status === 'searching' || state.status === 'idle') {
    return <Searching onBack={onBack} />;
  }
  if (state.status === 'error') {
    return (
      <MessageScreen
        title="Couldn't check this book"
        body="Try again in a moment."
        primary={{ label: 'Try again', onPress: onRetry }}
        secondary={{ label: 'Back', onPress: onBack }}
      />
    );
  }
  if (!state.result || state.result.status === 'unavailable') {
    return (
      <MessageScreen
        title="No open edition available"
        body="Try another book or come back later."
        primary={{ label: 'Scan another book', onPress: onScanAnother }}
        secondary={{ label: 'Back', onPress: onBack }}
      />
    );
  }
  if (!state.result.digitalEdition || !state.result.source || !state.result.rights || !state.result.provenance || !state.result.delivery) {
    return (
      <MessageScreen
        title="Couldn't check this book"
        body="Try again in a moment."
        primary={{ label: 'Try again', onPress: onRetry }}
        secondary={{ label: 'Back', onPress: onBack }}
      />
    );
  }
  return (
    <Ready
      result={state.result}
      onScanAnother={onScanAnother}
      exportState={exportState}
      onExport={onExport}
      onCancelExport={onCancelExport}
      onRetryExport={onRetryExport}
      onRefreshEdition={onRefreshEdition}
    />
  );
}

function editionAnnouncement(state: EditionState, exportState: ExportState): string | null {
  if (state.status === 'searching' || state.status === 'idle') {
    return 'Looking for a copy you can open.';
  }
  if (state.status === 'error') {
    return "Couldn't check this book. Try again in a moment.";
  }
  if (!state.result || state.result.status === 'unavailable') {
    return 'No open edition available. Try another book or come back later.';
  }
  if (exportState.status === 'downloading') {
    return 'Getting your book ready.';
  }
  if (exportState.status === 'sharing') {
    return exportState.intent === 'files'
      ? 'Choose Files in the share sheet.'
      : 'Choose Books in the share sheet.';
  }
  if (exportState.status === 'error') {
    return exportState.message ?? 'The book could not be prepared.';
  }
  if (exportState.status === 'ready' && exportState.message) {
    return exportState.message;
  }
  return `${state.result.digitalEdition?.title ?? 'Your book'} is ready to read.`;
}

function Searching({ onBack }: { onBack(): void }) {
  return (
    <SafeAreaView style={styles.screen}>
      <View style={[styles.content, styles.centered]}>
        <Entrance testID="searching-content">
          <View style={styles.messageCopy}>
            <Text style={styles.title}>Finding a reading copy</Text>
            <Text accessibilityLiveRegion="polite" style={styles.body}>
              Looking for a copy you can open…
            </Text>
          </View>
        </Entrance>
        <SecondaryButton label="Cancel" onPress={onBack} />
      </View>
    </SafeAreaView>
  );
}

function Ready({
  result,
  onScanAnother,
  exportState,
  onExport,
  onCancelExport,
  onRetryExport,
  onRefreshEdition,
}: {
  result: NonNullable<EditionState['result']>;
  onScanAnother(): void;
  exportState: ExportState;
  onExport(intent: ExportIntent): void;
  onCancelExport(): void;
  onRetryExport(): void;
  onRefreshEdition(): void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const digital = result.digitalEdition!;
  const source = result.source!;
  const rights = result.rights!;
  const provenance = result.provenance!;
  const physical = result.physicalEdition;
  const physicalPublication = [physical?.publisher, physical?.publishedDate].filter(Boolean).join(', ');
  const isGenerated = provenance.transformation === 'generated';

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Ready to read</Text>
        <Entrance distance={motion.cardDistance} testID="ready-edition-card">
          <View style={styles.editionCard}>
            {digital.coverUrl ? (
              <Image accessible={false} source={{ uri: digital.coverUrl }} style={styles.cover} />
            ) : (
              <View style={[styles.cover, styles.coverPlaceholder]}>
                <Text style={styles.coverPlaceholderText}>No cover available</Text>
              </View>
            )}
            <View style={styles.editionCopy}>
              <Text accessibilityLiveRegion="polite" style={styles.editionTitle}>{digital.title}</Text>
              <Text style={styles.editionAuthor}>{digital.authors.join(', ')}</Text>
            </View>
          </View>
        </Entrance>
        <ExportActions
          state={exportState}
          onExport={onExport}
          onCancel={onCancelExport}
          onRetry={onRetryExport}
          onRefreshEdition={onRefreshEdition}
        />
        <SecondaryButton
          compact
          label={detailsOpen ? 'Hide details' : 'Details'}
          onPress={() => setDetailsOpen((open) => !open)}
        />
        {detailsOpen ? (
          <View style={styles.detailsCard} testID="edition-details">
            <Text style={styles.detailsTitle}>Details</Text>
            <Detail label="Source" value={source.organization} />
            <Detail label="License" value={rights.licenseName} />
            {rights.attribution ? <Detail label="Attribution" value={rights.attribution} /> : null}
            <Detail label="Territory" value={rights.territory === 'US' ? 'United States' : rights.territory} />
            <Detail label="File" value={isGenerated ? 'Generated from authorized source' : 'Passed through unchanged'} />
            {isGenerated ? (
              <>
                <Detail label="Converter" value={provenance.generatorVersion ?? 'Deterministic converter'} />
                <Detail label="Steps" value={provenance.transformationSteps.join(' → ')} />
              </>
            ) : null}
            <Detail label="Validation" value={`EPUBCheck ${provenance.epubcheckVersion} · Valid`} />
            <Detail label="Sources checked" value={provenance.sourceAttempts.join(' → ')} />
            <Detail label="Reviewed" value={provenance.catalogReviewedAt} />
            <Detail label={isGenerated ? 'Source retrieved' : 'Retrieved'} value={provenance.retrievedAt} />
            {isGenerated ? <Detail label="Generated" value={provenance.generatedAt ?? 'Conversion time unavailable'} /> : null}
            {isGenerated ? (
              <>
                <Text style={styles.hash}>Source SHA-256 {provenance.originalSha256.slice(0, 12)}…</Text>
                <Text style={styles.hash}>EPUB SHA-256 {provenance.finalSha256.slice(0, 12)}…</Text>
              </>
            ) : (
              <Text style={styles.hash}>SHA-256 {provenance.finalSha256.slice(0, 12)}…</Text>
            )}
            <Detail label="Your physical edition" value={physicalPublication || 'Edition details unavailable'} />
            <Text style={styles.detailsBody}>
              The open digital edition may differ from your physical copy in cover, introduction, notes, formatting, or pagination.
            </Text>
            {isGenerated ? (
              <Text style={styles.detailsBody}>
                A reviewed, rights-cleared source was converted into this EPUB without AI-generated text.
              </Text>
            ) : null}
            {provenance.sourceAttempts.length > 1 ? (
              <Text style={styles.detailsBody}>
                Checked a later approved path after an earlier option could not be delivered.
              </Text>
            ) : null}
            <Text style={styles.detailsBody}>{rights.rightsStatement}</Text>
          </View>
        ) : null}
        <SecondaryButton compact label="Scan another book" onPress={onScanAnother} />
      </ScrollView>
    </SafeAreaView>
  );
}

function ExportActions({
  state,
  onExport,
  onCancel,
  onRetry,
  onRefreshEdition,
}: {
  state: ExportState;
  onExport(intent: ExportIntent): void;
  onCancel(): void;
  onRetry(): void;
  onRefreshEdition(): void;
}) {
  if (state.status === 'downloading') {
    const percentage = state.progress?.fraction === null || state.progress?.fraction === undefined
      ? 'Preparing EPUB…'
      : `${Math.round(state.progress.fraction * 100)}%`;
    return (
      <View style={styles.exportPanel}>
        <Text accessibilityLiveRegion="polite" style={styles.exportTitle}>Getting your book ready</Text>
        <Text style={styles.exportBody}>{percentage}</Text>
        <SecondaryButton label="Cancel download" onPress={onCancel} />
      </View>
    );
  }
  if (state.status === 'sharing') {
    const instruction = state.intent === 'files'
      ? 'Choose Files in the share sheet.'
      : 'Choose Books in the share sheet.';
    return (
      <View style={styles.exportPanel}>
        <Text accessibilityLiveRegion="polite" style={styles.exportTitle}>{instruction}</Text>
      </View>
    );
  }
  return (
    <View style={styles.exportStack}>
      {state.message && state.status !== 'error' ? (
        <Text accessibilityLiveRegion="polite" style={styles.exportBody}>
          {state.message}
        </Text>
      ) : null}
      {state.status === 'error' ? (
        <View style={styles.exportPanel}>
          <Text accessibilityLiveRegion="assertive" accessibilityRole="alert" style={styles.exportBody}>
            {state.message ?? 'The book could not be prepared.'}
          </Text>
          {state.code === 'expired' ? (
            <PrimaryButton label="Check edition again" onPress={onRefreshEdition} />
          ) : (
            <SecondaryButton label="Try download again" onPress={onRetry} />
          )}
        </View>
      ) : null}
      <PrimaryButton label="Open in Books" onPress={() => onExport('books')} />
      <SecondaryButton label="Save to Files" onPress={() => onExport('files')} />
    </View>
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
        <Entrance testID="recovery-content">
          <View style={styles.messageCopy}>
            <Text style={styles.title}>{title}</Text>
            <Text accessibilityLiveRegion="assertive" accessibilityRole="alert" style={styles.body}>
              {body}
            </Text>
          </View>
        </Entrance>
        <PrimaryButton label={primary.label} onPress={primary.onPress} />
        <SecondaryButton label={secondary.label} onPress={secondary.onPress} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.canvas, flex: 1 },
  content: { gap: spacing.xl, padding: spacing.xl, paddingBottom: 48 },
  centered: { flex: 1, justifyContent: 'center' },
  messageCopy: { gap: spacing.md },
  title: { color: colors.ink, fontSize: type.title, fontWeight: '700', letterSpacing: -0.8 },
  body: { color: colors.mutedInk, fontSize: type.body, lineHeight: 25 },
  editionCard: {
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: radius.card,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.lg,
    padding: spacing.lg,
  },
  cover: {
    backgroundColor: colors.evergreenSoft,
    borderRadius: radius.control,
    height: 192,
    width: 128,
  },
  coverPlaceholder: { alignItems: 'center', justifyContent: 'center', padding: spacing.md },
  coverPlaceholderText: {
    color: colors.mutedInk,
    fontSize: type.metadata,
    fontWeight: '600',
    lineHeight: 18,
    textAlign: 'center',
  },
  editionCopy: { flex: 1, gap: spacing.sm, justifyContent: 'center' },
  editionTitle: { color: colors.ink, fontSize: 26, fontWeight: '700', lineHeight: 31 },
  editionAuthor: { color: colors.mutedInk, fontSize: type.body, lineHeight: 23 },
  exportStack: { gap: spacing.md },
  exportPanel: {
    backgroundColor: colors.evergreenSoft,
    borderColor: colors.line,
    borderRadius: radius.card,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.lg,
  },
  exportTitle: { color: colors.ink, fontSize: type.body, fontWeight: '700', lineHeight: 24 },
  exportBody: { color: colors.mutedInk, fontSize: 15, lineHeight: 21 },
  detailsCard: {
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: radius.card,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg,
  },
  detailsTitle: { color: colors.ink, fontSize: type.body, fontWeight: '700' },
  detailRow: { flexDirection: 'row', gap: spacing.lg, justifyContent: 'space-between' },
  detailLabel: { color: colors.mutedInk, flexShrink: 0, fontSize: type.metadata },
  detailValue: { color: colors.ink, flex: 1, fontSize: type.metadata, fontWeight: '600', textAlign: 'right' },
  hash: { color: colors.mutedInk, fontFamily: 'Courier', fontSize: 12 },
  detailsBody: { color: colors.mutedInk, fontSize: type.metadata, lineHeight: 20 },
});
