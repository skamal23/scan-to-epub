import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Copy, Cover, EmptyMessage, Icon, IconButton, Skeleton } from '../components/UI';
import { FilterTabs } from '../components/FilterTabs';
import { colors, fonts } from '../ui/theme';
import type { LibraryBook } from '../library/types';

export function LibraryScreen({
  books,
  loading,
  error,
  importing,
  onOpen,
  onScan,
  onImport,
  onDetails,
  onRetry,
  onFind,
}: {
  books: LibraryBook[];
  loading: boolean;
  error: string | null;
  importing: boolean;
  onOpen(book: LibraryBook): void;
  onScan(): void;
  onImport(): void;
  onDetails(book: LibraryBook): void;
  onRetry(): void;
  onFind(query: string): void;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('All books');
  const { width, height } = useWindowDimensions();
  const welcomeWidth = height < 700 ? 106 : 132;
  const cardWidth = Math.min((width - 72) / 2, 175);
  const filtered = books.filter(
    (book) =>
      `${book.title} ${book.authors.join(' ')}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()) &&
      (filter !== 'Reading' || (book.progress > 0 && book.progress < 0.98)) &&
      (filter !== 'Finished' || book.progress >= 0.98),
  );
  const current = books.find((book) => book.openedAt && book.progress < 0.98);
  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <View style={s.heading}>
          <View style={{ flex: 1, paddingRight: 8 }}>
            <Copy weight="semibold" style={s.title}>
              Your library
            </Copy>
          </View>
          <IconButton name="plus" label="Import EPUB" onPress={onImport} />
        </View>
        <View style={s.search}>
          <Icon name="search" size={20} color={colors.mutedInk} />
          <TextInput
            accessibilityLabel="Search your library"
            placeholder="Title or author"
            placeholderTextColor="#94999D"
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => onFind(query)}
            returnKeyType="search"
            style={s.input}
          />
          <IconButton
            name="arrow-up-right"
            label="Find a book online"
            onPress={() => onFind(query)}
          />
          {query ? (
            <IconButton name="x" label="Clear library search" onPress={() => setQuery('')} />
          ) : null}
        </View>
        {importing ? (
          <View style={s.importing}>
            <Skeleton width={35} height={50} radius={3} />
            <View style={{ gap: 8, flex: 1 }}>
              <Copy weight="medium">Adding your book…</Copy>
              <Copy style={s.subtitle}>Checking the file and saving it offline.</Copy>
            </View>
          </View>
        ) : null}
        {error ? (
          <EmptyMessage
            title="Library unavailable"
            body={error}
            action="Try again"
            onPress={onRetry}
          />
        ) : loading ? (
          <View style={{ gap: 24 }}>
            <Skeleton height={190} radius={26} />
            <View style={s.grid}>
              <Skeleton width={cardWidth} height={240} />
              <Skeleton width={cardWidth} height={240} />
            </View>
          </View>
        ) : books.length === 0 ? (
          <View style={s.welcome}>
            <View style={s.bookStack}>
              <View style={[s.backBook, { width: welcomeWidth, height: welcomeWidth * 1.45 }]} />
              <View style={[s.midBook, { width: welcomeWidth, height: welcomeWidth * 1.48 }]} />
              <Cover title="The next chapter" author="IS YOURS" width={welcomeWidth} lifted />
            </View>
            <Copy weight="semibold" style={s.welcomeTitle}>
              Your next read.
            </Copy>
            <Copy style={s.welcomeBody}>Scan a cover. Find an open edition. Read.</Copy>
            <Button title="Scan your first book" icon="arrow-up-right" onPress={onScan} />
            <Button title="Import an EPUB" secondary onPress={onImport} />
          </View>
        ) : (
          <>
            {current && !query && filter === 'All books' ? (
              <View>
                <Copy weight="semibold" style={s.sectionTitle}>
                  Continue reading
                </Copy>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Continue reading ${current.title}`}
                  onPress={() => onOpen(current)}
                  style={s.continueCard}
                >
                  <Cover
                    uri={current.coverUri}
                    title={current.title}
                    author={current.authors[0]}
                    width={76}
                  />
                  <View style={s.continueCopy}>
                    <Copy
                      weight="semibold"
                      style={{ fontSize: 18, letterSpacing: -0.4 }}
                      numberOfLines={3}
                    >
                      {current.title}
                    </Copy>
                    <Copy style={s.subtitle} numberOfLines={1}>
                      {current.authors.join(', ')}
                    </Copy>
                    <View style={s.track}>
                      <View
                        style={[s.fill, { width: `${Math.max(current.progress * 100, 3)}%` }]}
                      />
                    </View>
                    <View style={s.between}>
                      <Copy style={s.subtitle}>{Math.round(current.progress * 100)}% read</Copy>
                      <Icon name="arrow-right" size={20} />
                    </View>
                  </View>
                </Pressable>
              </View>
            ) : null}
            <View style={s.between}>
              <Copy weight="semibold" style={s.sectionTitle}>
                On your shelf
              </Copy>
              <Copy style={s.subtitle}>
                {books.length} {books.length === 1 ? 'book' : 'books'}
              </Copy>
            </View>
            <FilterTabs value={filter} onChange={setFilter} />
            {filtered.length ? (
              <View style={s.grid}>
                {filtered.map((book) => (
                  <View key={book.id} style={{ width: cardWidth }}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Read ${book.title}`}
                      onPress={() => onOpen(book)}
                    >
                      <View style={s.bookWell}>
                        <Cover
                          uri={book.coverUri}
                          title={book.title}
                          author={book.authors[0]}
                          width={cardWidth - 22}
                        />
                      </View>
                      <Copy
                        weight="semibold"
                        numberOfLines={2}
                        style={{ marginTop: 16, fontSize: 16 }}
                      >
                        {book.title}
                      </Copy>
                      <Copy numberOfLines={1} style={[s.subtitle, { marginTop: 5 }]}>
                        {book.authors.join(', ') || 'Unknown author'}
                      </Copy>
                    </Pressable>
                    <View style={s.between}>
                      <Copy style={[s.subtitle, { fontSize: 12 }]}>
                        {book.progress >= 0.98
                          ? 'Finished'
                          : book.progress > 0
                            ? `${Math.round(book.progress * 100)}% read`
                            : 'Ready to read'}
                      </Copy>
                      <IconButton
                        name="more-horizontal"
                        label={`Details for ${book.title}`}
                        onPress={() => onDetails(book)}
                      />
                    </View>
                  </View>
                ))}
              </View>
            ) : (
              <EmptyMessage
                title="Nothing on this shelf yet"
                body={query ? 'Try another title or author.' : 'Books appear here as you read.'}
              />
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: {
    padding: 24,
    paddingBottom: 130,
    gap: 20,
    width: '100%',
    maxWidth: 620,
    alignSelf: 'center',
  },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { fontSize: 30, letterSpacing: -1 },
  subtitle: { fontSize: 13, color: colors.mutedInk },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 18,
    minHeight: 55,
    backgroundColor: 'white',
    borderRadius: 30,
  },
  input: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 16,
    color: colors.ink,
    minHeight: 50,
  },
  sectionTitle: { fontSize: 18, letterSpacing: -0.4, marginBottom: 14 },
  between: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  continueCard: {
    flexDirection: 'row',
    backgroundColor: 'white',
    borderRadius: 25,
    padding: 18,
    gap: 18,
  },
  continueCopy: { flex: 1, justifyContent: 'center', gap: 6 },
  track: {
    height: 3,
    backgroundColor: colors.line,
    borderRadius: 3,
    marginTop: 12,
    marginBottom: 4,
    overflow: 'hidden',
  },
  fill: { height: 3, backgroundColor: colors.ink },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 24 },
  bookWell: { alignItems: 'center', paddingTop: 8 },
  welcome: { gap: 13, paddingTop: 0 },
  welcomeTitle: {
    fontSize: 28,
    lineHeight: 34,
    letterSpacing: -1,
    textAlign: 'center',
    marginTop: 13,
  },
  welcomeBody: {
    color: colors.mutedInk,
    textAlign: 'center',
    lineHeight: 24,
    paddingHorizontal: 15,
    marginBottom: 14,
  },
  bookStack: { alignItems: 'center', paddingVertical: 12 },
  backBook: {
    position: 'absolute',
    borderRadius: 8,
    backgroundColor: '#D5C8B0',
    transform: [{ rotate: '13deg' }, { translateX: 28 }],
    top: 20,
  },
  midBook: {
    position: 'absolute',
    borderRadius: 8,
    backgroundColor: '#ABB7B3',
    transform: [{ rotate: '-14deg' }, { translateX: -22 }],
    top: 19,
  },
  importing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    padding: 18,
    backgroundColor: 'white',
    borderRadius: 22,
  },
});
