import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Copy, Cover, Button, IconButton, Skeleton } from '../components/UI';
import type { MetadataCandidate, MetadataQuery } from '../api/metadata';
import { colors, fonts } from '../ui/theme';

export function FindBookScreen({
  candidates,
  busy,
  error,
  partial,
  onSearch,
  onChoose,
  onBack,
}: {
  candidates: MetadataCandidate[];
  busy: boolean;
  error: string | null;
  partial: boolean;
  onSearch(query: MetadataQuery): void;
  onChoose(candidate: MetadataCandidate): void;
  onBack(): void;
}) {
  const [title, setTitle] = useState(''),
    [author, setAuthor] = useState('');
  const submit = () => {
    const value = title.trim();
    if (value)
      onSearch(
        /^[\d\s-]{10,20}$/.test(value)
          ? { isbn: value.replace(/[\s-]/g, '') }
          : {
              title: value,
              ...(author.trim() ? { author: author.trim() } : {}),
            },
      );
  };
  return (
    <SafeAreaView style={s.screen}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
        <IconButton name="chevron-left" label="Back" onPress={onBack} />
        <Copy weight="semibold" style={s.title}>
          Find a book
        </Copy>

        <TextInput
          accessibilityLabel="Book title or ISBN"
          placeholder="Title or ISBN"
          value={title}
          onChangeText={setTitle}
          style={s.input}
          returnKeyType="search"
          onSubmitEditing={submit}
        />
        <TextInput
          accessibilityLabel="Author (optional)"
          placeholder="Author · optional"
          value={author}
          onChangeText={setAuthor}
          style={s.input}
          returnKeyType="search"
          onSubmitEditing={submit}
        />
        <Button
          title={busy ? 'Finding your book…' : 'Find book'}
          icon="search"
          busy={busy}
          disabled={!title.trim()}
          onPress={submit}
        />
        {error ? (
          <View accessibilityRole="alert" style={s.notice}>
            <Copy style={s.body}>{error}</Copy>
          </View>
        ) : null}
        {partial ? (
          <Copy style={s.body}>
            Some catalogs are unavailable. You can still choose from the matches below.
          </Copy>
        ) : null}
        {busy
          ? [0, 1, 2].map((i) => (
              <View key={i} style={s.row}>
                <Skeleton width={65} height={98} radius={5} />
                <View style={{ flex: 1, gap: 10 }}>
                  <Skeleton />
                  <Skeleton width="70%" />
                </View>
              </View>
            ))
          : candidates.map((candidate) => (
              <Pressable
                key={candidate.candidateId}
                accessibilityRole="button"
                accessibilityLabel={`Choose ${candidate.work.title}`}
                onPress={() => onChoose(candidate)}
                style={s.row}
              >
                <Cover uri={candidate.edition.coverUrl} title={candidate.work.title} width={65} />
                <View style={{ flex: 1, gap: 7 }}>
                  <Copy weight="semibold" style={{ fontSize: 19 }}>
                    {candidate.work.title}
                  </Copy>
                  <Copy style={s.body}>{candidate.work.authors.join(', ')}</Copy>
                  <Copy style={{ fontSize: 11, color: colors.mutedInk }}>
                    {candidate.confidence === 'low'
                      ? 'Possible match · check the details'
                      : candidate.edition.publishedDate || 'View book'}
                  </Copy>
                </View>
              </Pressable>
            ))}
      </ScrollView>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: {
    padding: 24,
    gap: 16,
    maxWidth: 620,
    width: '100%',
    alignSelf: 'center',
    paddingBottom: 40,
  },
  title: { fontSize: 30, letterSpacing: -1, marginTop: 18 },
  body: { color: colors.mutedInk, lineHeight: 23, fontSize: 15 },
  input: {
    backgroundColor: 'white',
    borderRadius: 24,
    padding: 19,
    fontSize: 17,
    fontFamily: fonts.regular,
  },
  row: {
    flexDirection: 'row',
    gap: 23,
    padding: 20,
    backgroundColor: 'white',
    borderRadius: 26,
    alignItems: 'center',
  },
  notice: { padding: 18, borderRadius: 20, backgroundColor: '#ECEEF0' },
});
