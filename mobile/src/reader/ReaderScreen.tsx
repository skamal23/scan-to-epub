import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Button, Copy, EmptyMessage, IconButton, Skeleton } from '../components/UI';
import { Sheet } from '../components/Sheet';
import { ReaderSurface } from './ReaderSurface';
import { readerColors, type ReaderEvent, type ReaderHandle } from './document';
import type { LibraryBook, ReaderPreferences } from '../library/types';
import { colors, fonts } from '../ui/theme';

export function ReaderScreen({
  book,
  preferences,
  onPreferences,
  onUpdate,
  onClose,
  onReady,
  onLoadError,
}: {
  book: LibraryBook;
  preferences: ReaderPreferences;
  onPreferences(value: ReaderPreferences): Promise<void>;
  onUpdate(patch: Partial<LibraryBook>): Promise<unknown>;
  onClose(): void;
  onReady?(): void;
  onLoadError?(): void;
}) {
  const surface = useRef<ReaderHandle>(null);
  const loadingCallbacks = useRef({ onReady, onLoadError });
  loadingCallbacks.current = { onReady, onLoadError };
  const [ready, setReady] = useState(false),
    [chrome, setChrome] = useState(true),
    [error, setError] = useState<string | null>(null),
    [saveError, setSaveError] = useState(false);
  const [sheet, setSheet] = useState<'contents' | 'appearance' | 'search' | null>(null);
  const [toc, setToc] = useState<{ label: string; href: string }[]>([]),
    [chapter, setChapter] = useState('');
  const [searched, setSearched] = useState(false);
  const [settingsError, setSettingsError] = useState(false);
  const pendingPreferences = useRef<ReaderPreferences | null>(null);
  const [query, setQuery] = useState(''),
    [searching, setSearching] = useState(false),
    [results, setResults] = useState<{ excerpt: string; cfi: string }[]>([]);
  const pending = useRef<Partial<LibraryBook> | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    update = useRef(onUpdate);
  update.current = onUpdate;
  const latestLocation = useRef(book.location),
    latestProgress = useRef(book.progress);
  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    const patch = pending.current;
    if (!patch) return;
    pending.current = null;
    try {
      await update.current(patch);
      setSaveError(false);
    } catch {
      pending.current = Object.assign({}, patch, pending.current);
      setSaveError(true);
    }
  }, []);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') void flush();
    });
    return () => {
      sub.remove();
      void flush();
    };
  }, [flush]);
  useEffect(() => {
    if (ready) surface.current?.command({ type: 'preferences', preferences });
  }, [preferences, ready]);
  useEffect(() => {
    if (ready) return;
    const timeout = setTimeout(() => {
      setError('Opening this book is taking longer than expected. Try reopening it.');
      loadingCallbacks.current.onLoadError?.();
    }, 25000);
    return () => clearTimeout(timeout);
  }, [ready]);
  const event = useCallback(
    (value: ReaderEvent) => {
      if (value.type === 'ready') {
        setReady(true);
        setToc(value.toc);
        setError(null);
        loadingCallbacks.current.onReady?.();
      }
      if (value.type === 'tap') setChrome((show) => !show);
      if (value.type === 'error') {
        setError(value.message);
        setSearching(false);
        loadingCallbacks.current.onLoadError?.();
      }
      if (value.type === 'search') {
        setResults(value.results);
        setSearching(false);
      }
      if (value.type === 'location') {
        setChapter(value.chapter);
        latestLocation.current = value.cfi;
        latestProgress.current = value.progress;
        pending.current = {
          ...pending.current,
          location: value.cfi,
          progress: value.progress,
          openedAt: new Date().toISOString(),
        };
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => void flush(), 350);
      }
    },
    [flush],
  );
  const theme = readerColors[preferences.theme];
  const bookmarked = book.bookmarks.some((item) => item.cfi === latestLocation.current);
  const bookmark = async () => {
    const cfi = latestLocation.current;
    if (!cfi) return;
    pending.current = {
      ...pending.current,
      bookmarks: bookmarked
        ? book.bookmarks.filter((item) => item.cfi !== cfi)
        : [
            ...book.bookmarks,
            {
              cfi,
              label: chapter || `${Math.round(latestProgress.current * 100)}% into the book`,
              createdAt: new Date().toISOString(),
            },
          ],
    };
    await flush();
  };
  const apply = async (patch: Partial<ReaderPreferences>) => {
    const value = { ...preferences, ...patch };
    pendingPreferences.current = value;
    try {
      await onPreferences(value);
      pendingPreferences.current = null;
      setSettingsError(false);
    } catch {
      setSettingsError(true);
    }
  };
  const go = (target: string) => {
    surface.current?.command({ type: 'goto', target });
    setSheet(null);
    setError(null);
  };
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
      <StatusBar style={preferences.theme === 'dark' ? 'light' : 'dark'} />
      <View
        style={[s.header, { opacity: chrome ? 1 : 0 }]}
        pointerEvents={chrome ? 'auto' : 'none'}
      >
        <IconButton
          name="chevron-left"
          label="Back to library"
          onPress={() => {
            void flush().finally(onClose);
          }}
        />
        <Copy
          numberOfLines={1}
          style={{
            flex: 1,
            textAlign: 'center',
            fontSize: 13,
            color: theme.color,
          }}
        >
          {book.title}
        </Copy>
        <IconButton
          name="bookmark"
          label={bookmarked ? 'Remove bookmark' : 'Bookmark this page'}
          selected={bookmarked}
          onPress={() => void bookmark()}
        />
      </View>
      <View style={{ flex: 1 }}>
        <ReaderSurface ref={surface} book={book} preferences={preferences} onEvent={event} />
        {!ready && !error ? (
          <View style={[StyleSheet.absoluteFill, s.loading, { backgroundColor: theme.background }]}>
            <Copy
              style={{
                fontSize: 12,
                letterSpacing: 1.5,
                color: colors.mutedInk,
                marginBottom: 20,
              }}
            >
              OPENING YOUR BOOK
            </Copy>
            {[95, 100, 90, 100, 97, 85, 100, 94, 65].map((width, index) => (
              <Skeleton key={index} width={`${width}%`} height={14} />
            ))}
          </View>
        ) : null}
        {error ? (
          <View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: theme.background, justifyContent: 'center' },
            ]}
          >
            <EmptyMessage
              title="Let’s try that again"
              body={error}
              action="Back to library"
              onPress={() => void flush().finally(onClose)}
            />
            {toc.length ? (
              <Button title="Choose a chapter" secondary onPress={() => setSheet('contents')} />
            ) : null}
          </View>
        ) : null}
      </View>
      {saveError ? (
        <Pressable onPress={() => void flush()}>
          <Copy
            style={{
              textAlign: 'center',
              color: colors.danger,
              padding: 8,
              fontSize: 12,
            }}
          >
            Couldn’t save your changes. Tap to retry.
          </Copy>
        </Pressable>
      ) : null}
      {settingsError ? (
        <Pressable
          onPress={() => pendingPreferences.current && void apply(pendingPreferences.current)}
        >
          <Copy style={{ color: colors.danger, textAlign: 'center', padding: 8, fontSize: 12 }}>
            Couldn’t save your appearance. Tap to retry.
          </Copy>
        </Pressable>
      ) : null}
      <View style={s.footer}>
        <View
          style={[s.tools, { opacity: chrome ? 1 : 0 }]}
          pointerEvents={chrome ? 'auto' : 'none'}
        >
          <IconButton name="list" label="Table of contents" onPress={() => setSheet('contents')} />
          <IconButton name="search" label="Search this book" onPress={() => setSheet('search')} />
          <IconButton
            name="type"
            label="Reading appearance"
            onPress={() => setSheet('appearance')}
          />
        </View>
        <View style={s.pagination}>
          <IconButton
            name="chevron-left"
            label="Previous page"
            onPress={() => surface.current?.command({ type: 'previous' })}
          />
          <Pressable
            accessibilityLabel="Show reading controls"
            onPress={() => setChrome((show) => !show)}
            style={{ flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
          >
            <Copy numberOfLines={1} style={{ fontSize: 11, color: theme.color, opacity: 0.6 }}>
              {chapter || 'Your reading space'}
            </Copy>
            <Copy
              style={{
                fontSize: 11,
                color: theme.color,
                opacity: 0.6,
                marginTop: 4,
              }}
            >
              {Math.round(book.progress * 100)}% read
            </Copy>
          </Pressable>
          <IconButton
            name="chevron-right"
            label="Next page"
            onPress={() => surface.current?.command({ type: 'next' })}
          />
        </View>
      </View>
      <Sheet visible={sheet === 'contents'} title="In this book" onClose={() => setSheet(null)}>
        {book.bookmarks.length ? (
          <>
            <Copy weight="semibold">Your bookmarks</Copy>
            {book.bookmarks.map((item) => (
              <Pressable key={item.cfi} onPress={() => go(item.cfi)} style={s.row}>
                <Copy>{item.label}</Copy>
              </Pressable>
            ))}
            <Copy weight="semibold" style={{ marginTop: 12 }}>
              Chapters
            </Copy>
          </>
        ) : null}
        {toc.map((item, index) => (
          <Pressable
            key={`${item.href}-${index}`}
            accessibilityRole="button"
            onPress={() => go(item.href)}
            style={s.row}
          >
            <Copy style={{ lineHeight: 24 }}>{item.label}</Copy>
          </Pressable>
        ))}
      </Sheet>
      <Sheet
        visible={sheet === 'appearance'}
        title="Reading settings"
        onClose={() => setSheet(null)}
      >
        <Copy style={s.label}>PAGE COLOR</Copy>
        <View style={s.choices}>
          {(['light', 'sepia', 'dark'] as const).map((mode) => (
            <Pressable
              key={mode}
              accessibilityRole="button"
              accessibilityState={{ selected: preferences.theme === mode }}
              onPress={() => void apply({ theme: mode })}
              style={[
                s.swatch,
                {
                  backgroundColor: readerColors[mode].background,
                  borderColor: preferences.theme === mode ? '#879A8C' : colors.line,
                  borderWidth: preferences.theme === mode ? 3 : 1,
                },
              ]}
            >
              <Copy
                style={{
                  color: readerColors[mode].color,
                  textTransform: 'capitalize',
                }}
              >
                {mode}
              </Copy>
            </Pressable>
          ))}
        </View>
        <Copy style={s.label}>TEXT SIZE</Copy>
        <View style={s.choices}>
          <IconButton
            name="minus"
            label="Decrease text size"
            onPress={() => void apply({ fontSize: Math.max(14, preferences.fontSize - 1) })}
          />
          <Copy style={{ fontSize: 22 }}>{preferences.fontSize}</Copy>
          <IconButton
            name="plus"
            label="Increase text size"
            onPress={() => void apply({ fontSize: Math.min(32, preferences.fontSize + 1) })}
          />
        </View>
        <Copy style={s.label}>TYPEFACE</Copy>
        <View style={s.choices}>
          <Button
            title="Serif"
            secondary={preferences.font !== 'serif'}
            onPress={() => void apply({ font: 'serif' })}
          />
          <Button
            title="Sans"
            secondary={preferences.font !== 'sans-serif'}
            onPress={() => void apply({ font: 'sans-serif' })}
          />
        </View>
        <Copy style={s.label}>LINE SPACING</Copy>
        <View style={s.choices}>
          {[1.4, 1.7, 2].map((value) => (
            <Button
              key={value}
              title={value === 1.4 ? 'Close' : value === 1.7 ? 'Balanced' : 'Open'}
              secondary={preferences.lineHeight !== value}
              onPress={() => void apply({ lineHeight: value })}
            />
          ))}
        </View>
      </Sheet>
      <Sheet visible={sheet === 'search'} title="Find a passage" onClose={() => setSheet(null)}>
        <TextInput
          accessibilityLabel="Search text in this book"
          placeholder="A word or phrase"
          value={query}
          editable={!searching}
          onChangeText={(text) => {
            setQuery(text);
            setSearched(false);
            setResults([]);
          }}
          returnKeyType="search"
          onSubmitEditing={() => {
            setSearched(true);
            setSearching(true);
            surface.current?.command({ type: 'search', query });
          }}
          style={s.search}
        />
        <Button
          title={searching ? 'Searching…' : 'Search book'}
          disabled={query.trim().length < 2 || searching}
          onPress={() => {
            setSearched(true);
            setSearching(true);
            surface.current?.command({ type: 'search', query });
          }}
        />
        {results.map((item, index) => (
          <Pressable
            key={index}
            accessibilityRole="button"
            style={s.row}
            onPress={() => go(item.cfi)}
          >
            <Copy style={{ lineHeight: 24 }}>{item.excerpt}</Copy>
          </Pressable>
        ))}
        {!searching && query && results.length === 0 ? (
          <Copy style={{ color: colors.mutedInk }}>
            {searched
              ? 'No matching passages. Try another word or phrase.'
              : 'Search for a phrase to see matching passages.'}
          </Copy>
        ) : null}
      </Sheet>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 16,
    minHeight: 54,
    paddingVertical: 4,
  },
  footer: { paddingHorizontal: 16, paddingBottom: 2 },
  tools: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 24,
    height: 50,
  },
  pagination: { flexDirection: 'row', alignItems: 'center', gap: 15 },
  loading: { padding: 32, gap: 19 },
  row: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  label: {
    fontSize: 11,
    letterSpacing: 1.3,
    color: colors.mutedInk,
    marginTop: 12,
  },
  choices: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    flexWrap: 'wrap',
  },
  swatch: {
    flex: 1,
    minHeight: 58,
    paddingVertical: 12,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  search: {
    fontFamily: fonts.regular,
    fontSize: 17,
    backgroundColor: colors.canvas,
    padding: 18,
    borderRadius: 16,
  },
});
