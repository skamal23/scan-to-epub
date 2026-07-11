import { useEffect, useRef, useState } from 'react';
import {
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { MetadataCandidate, MetadataQuery } from '../api/metadata';
import type { SearchState } from '../state/searchState';
import { Entrance } from '../ui/Entrance';
import { PrimaryButton, SecondaryButton } from '../ui/primitives';
import { colors, radius, spacing, type } from '../ui/theme';

export function ManualSearchFlow({
  state,
  onBack,
  onCancel,
  onConfirm,
  onEdit,
  onRetry,
  onSearch,
  origin = 'manual',
}: {
  state: SearchState;
  onBack(): void;
  onCancel(): void;
  onConfirm(candidate: MetadataCandidate): void;
  onEdit(): void;
  onRetry(): void;
  onSearch(query: MetadataQuery): void;
  origin?: 'manual' | 'isbn' | 'cover';
  recognitionConfidence?: 'high' | 'medium' | 'low';
}) {
  const [draft, setDraft] = useState({ isbn: '', title: '', author: '' });

  if (state.status === 'searching') {
    return (
      <MessageScreen
        title="Searching book records…"
        body="Checking trusted metadata catalogs."
        secondaryAction={{ label: 'Cancel search', onPress: onCancel }}
      />
    );
  }
  if (state.status === 'empty') {
    return (
      <MessageScreen
        title="No books found"
        body="Try another ISBN, add the author, or check the spelling."
        secondaryAction={{ label: 'Edit search', onPress: onEdit }}
      />
    );
  }
  if (state.status === 'error') {
    return (
      <MessageScreen
        title="Search unavailable"
        body={state.message ?? 'Please try again.'}
        primaryAction={{ label: 'Try again', onPress: onRetry }}
        secondaryAction={{ label: 'Edit search', onPress: onEdit }}
      />
    );
  }
  if (state.status === 'candidates') {
    return (
      <CandidateScreen
        candidates={state.candidates}
        providerFailures={state.providerFailures}
        onBack={onEdit}
        onConfirm={onConfirm}
        origin={origin}
      />
    );
  }
  if (state.status === 'confirmed' && state.selected) {
    return <ConfirmedScreen candidate={state.selected} onBack={onEdit} />;
  }
  return (
    <SearchForm
      draft={draft}
      onBack={onBack}
      onChange={(field, value) => setDraft((current) => ({ ...current, [field]: value }))}
      onSearch={onSearch}
    />
  );
}

function SearchForm({
  draft,
  onBack,
  onChange,
  onSearch,
}: {
  draft: { isbn: string; title: string; author: string };
  onBack(): void;
  onChange(field: 'isbn' | 'title' | 'author', value: string): void;
  onSearch(query: MetadataQuery): void;
}) {
  const [validation, setValidation] = useState<string | null>(null);

  const submit = () => {
    Keyboard.dismiss();
    const normalizedIsbn = draft.isbn.trim();
    const normalizedTitle = draft.title.trim();
    const normalizedAuthor = draft.author.trim();
    if (normalizedIsbn && normalizedTitle) {
      setValidation('Use either ISBN or title and author.');
      return;
    }
    if (normalizedIsbn) {
      setValidation(null);
      onSearch({ isbn: normalizedIsbn });
      return;
    }
    if (!normalizedTitle) {
      setValidation('Enter an ISBN or book title.');
      return;
    }
    setValidation(null);
    onSearch({ title: normalizedTitle, ...(normalizedAuthor ? { author: normalizedAuthor } : {}) });
  };

  return (
    <SafeAreaView key="search-form-screen" style={styles.screen}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView
          key="search-form-scroll"
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <SecondaryButton compact label="Back" onPress={onBack} />
          <Entrance>
            <View style={styles.headingGroup}>
              <Text style={styles.title}>Find your book</Text>
              <Text style={styles.body}>Search by ISBN or title.</Text>
            </View>
          </Entrance>
          <Field
            accessibilityLabel="ISBN"
            label="ISBN"
            onChangeText={(value) => onChange('isbn', value)}
            placeholder="9780141439518"
            testID="isbn-input"
            value={draft.isbn}
          />
          <Text style={styles.or}>OR</Text>
          <Field
            accessibilityLabel="Book title"
            label="Title"
            onChangeText={(value) => onChange('title', value)}
            placeholder="Pride and Prejudice"
            testID="title-input"
            value={draft.title}
          />
          <Field
            accessibilityLabel="Book author"
            label="Author (optional)"
            onChangeText={(value) => onChange('author', value)}
            placeholder="Jane Austen"
            testID="author-input"
            value={draft.author}
          />
          {validation ? <Text style={styles.error}>{validation}</Text> : null}
          <PrimaryButton label="Find book" onPress={submit} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field(props: {
  accessibilityLabel: string;
  label: string;
  onChangeText(value: string): void;
  placeholder: string;
  testID: string;
  value: string;
}) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.label}>{props.label}</Text>
      <TextInput
        accessibilityLabel={props.accessibilityLabel}
        autoCapitalize="words"
        autoCorrect={false}
        onChangeText={props.onChangeText}
        placeholder={props.placeholder}
        placeholderTextColor={colors.mutedInk}
        style={styles.input}
        testID={props.testID}
        value={props.value}
      />
    </View>
  );
}

function CandidateScreen({
  candidates,
  providerFailures,
  onBack,
  onConfirm,
  origin,
}: {
  candidates: MetadataCandidate[];
  providerFailures: string[];
  onBack(): void;
  onConfirm(candidate: MetadataCandidate): void;
  origin: 'manual' | 'isbn' | 'cover';
}) {
  const scrollView = useRef<ScrollView>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      scrollView.current?.scrollTo({ animated: false, y: 0 });
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <SafeAreaView key="candidate-screen" style={styles.screen}>
      <ScrollView
        key="candidate-scroll"
        ref={scrollView}
        contentContainerStyle={styles.content}
        contentOffset={{ x: 0, y: 0 }}
      >
        <SecondaryButton compact label={origin === 'cover' ? 'Scan again' : 'Edit search'} onPress={onBack} />
        <View style={styles.headingGroup}>
          <Text style={styles.title}>Is this your book?</Text>
          {providerFailures.length > 0 ? (
            <Entrance>
              <Text style={styles.warning}>Some catalogs were unavailable. Results may be limited.</Text>
            </Entrance>
          ) : null}
        </View>
        {candidates.map((candidate) => (
          <CandidateCard key={candidate.candidateId} candidate={candidate} onPress={() => onConfirm(candidate)} />
        ))}
        <SecondaryButton label={origin === 'cover' ? 'None—scan again' : 'None of these'} onPress={onBack} />
      </ScrollView>
    </SafeAreaView>
  );
}

function CandidateCard({ candidate, onPress }: { candidate: MetadataCandidate; onPress(): void }) {
  const [coverFailed, setCoverFailed] = useState(false);
  const publication = [candidate.edition.publisher, candidate.edition.publishedDate]
    .filter(Boolean)
    .join(' · ');
  return (
    <Pressable
      accessibilityLabel={`Choose ${candidate.work.title} by ${candidate.work.authors.join(', ') || 'unknown author'}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      {candidate.edition.coverUrl && !coverFailed ? (
        <Image
          accessible={false}
          source={{ uri: candidate.edition.coverUrl }}
          style={styles.cover}
          testID={`cover-${candidate.candidateId}`}
          onError={() => setCoverFailed(true)}
        />
      ) : (
        <View style={[styles.cover, styles.coverFallback]}>
          <Text style={styles.coverFallbackText}>No cover</Text>
        </View>
      )}
      <View style={styles.cardCopy}>
        <Text style={styles.cardTitle}>{candidate.work.title}</Text>
        <Text style={styles.cardAuthor}>{candidate.work.authors.join(', ') || 'Unknown author'}</Text>
        {publication ? <Text style={styles.cardMetadata}>{publication}</Text> : null}
      </View>
    </Pressable>
  );
}

function ConfirmedScreen({ candidate, onBack }: { candidate: MetadataCandidate; onBack(): void }) {
  const edition = [candidate.edition.publisher, candidate.edition.publishedDate].filter(Boolean).join(', ');
  return (
    <SafeAreaView style={styles.screen}>
      <View style={[styles.content, styles.centered]}>
        <Text style={styles.eyebrow}>WORK CONFIRMED</Text>
        <Text style={styles.title}>Work confirmed</Text>
        <Text style={styles.confirmedTitle}>{candidate.work.title}</Text>
        <Text style={styles.body}>{candidate.work.authors.join(', ')}</Text>
        <View style={styles.infoBox}>
          <Text style={styles.infoTitle}>Your physical edition</Text>
          <Text style={styles.infoBody}>{edition || 'Edition details unavailable'}</Text>
          <Text style={styles.infoBody}>The open digital edition may differ in cover, notes, formatting, or pagination.</Text>
        </View>
        <SecondaryButton label="Edit search" onPress={onBack} />
      </View>
    </SafeAreaView>
  );
}

function MessageScreen({
  title,
  body,
  primaryAction,
  secondaryAction,
}: {
  title: string;
  body: string;
  primaryAction?: { label: string; onPress(): void };
  secondaryAction: { label: string; onPress(): void };
}) {
  return (
    <SafeAreaView style={styles.screen}>
      <View style={[styles.content, styles.centered]}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>{body}</Text>
        {primaryAction ? (
          <PrimaryButton label={primaryAction.label} onPress={primaryAction.onPress} />
        ) : null}
        <SecondaryButton label={secondaryAction.label} onPress={secondaryAction.onPress} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { backgroundColor: colors.canvas, flex: 1 },
  content: { gap: spacing.lg, padding: spacing.xl, paddingBottom: 44 },
  centered: { flex: 1, justifyContent: 'center' },
  headingGroup: { gap: spacing.sm, marginVertical: spacing.xs },
  eyebrow: { color: colors.evergreen, fontSize: type.eyebrow, fontWeight: '700', letterSpacing: 1.4 },
  title: { color: colors.ink, fontSize: type.title, fontWeight: '700', letterSpacing: -0.7 },
  body: { color: colors.mutedInk, fontSize: type.body, lineHeight: 24 },
  fieldGroup: { gap: spacing.sm },
  label: { color: colors.ink, fontSize: 15, fontWeight: '600' },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: radius.control,
    borderWidth: 1,
    color: colors.ink,
    fontSize: type.body,
    minHeight: 52,
    paddingHorizontal: 14,
  },
  or: { color: colors.mutedInk, fontSize: type.eyebrow, fontWeight: '700', textAlign: 'center' },
  error: { color: colors.danger, fontSize: type.metadata },
  warning: { color: colors.warning, fontSize: type.metadata, lineHeight: 20 },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: radius.card,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.lg,
    padding: spacing.lg,
  },
  pressed: { opacity: 0.72 },
  cover: {
    backgroundColor: colors.evergreenSoft,
    borderRadius: radius.control,
    height: 132,
    width: 88,
  },
  coverFallback: { alignItems: 'center', justifyContent: 'center' },
  coverFallbackText: { color: colors.mutedInk, fontSize: type.eyebrow },
  cardCopy: { flex: 1, gap: spacing.xs, justifyContent: 'center' },
  cardTitle: { color: colors.ink, fontSize: 22, fontWeight: '700', lineHeight: 27 },
  cardAuthor: { color: colors.mutedInk, fontSize: 15 },
  cardMetadata: { color: colors.mutedInk, fontSize: type.metadata },
  confirmedTitle: { color: colors.ink, fontSize: 22, fontWeight: '600' },
  infoBox: {
    backgroundColor: colors.evergreenSoft,
    borderRadius: radius.control,
    gap: spacing.sm,
    padding: spacing.lg,
  },
  infoTitle: { color: colors.ink, fontSize: type.metadata, fontWeight: '700' },
  infoBody: { color: colors.mutedInk, fontSize: type.metadata, lineHeight: 20 },
});
