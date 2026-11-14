import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Linking, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as FileSystem from 'expo-file-system/legacy';
import * as DocumentPicker from 'expo-document-picker';
import { useFonts } from 'expo-font';
import { InstrumentSans_400Regular } from '@expo-google-fonts/instrument-sans/400Regular';
import { InstrumentSans_500Medium } from '@expo-google-fonts/instrument-sans/500Medium';
import { InstrumentSans_600SemiBold } from '@expo-google-fonts/instrument-sans/600SemiBold';
import { InstrumentSans_700Bold } from '@expo-google-fonts/instrument-sans/700Bold';
import {
  createMetadataClient,
  type MetadataCandidate,
  type MetadataClient,
  type MetadataQuery,
} from './src/api/metadata';
import {
  createEditionClient,
  requestForCandidate,
  type EditionClient,
  type EditionResolutionResult,
} from './src/api/editions';
import { createExpoCoverClient } from './src/api/coverRuntime';
import type { CoverClient, CoverRecognitionResult } from './src/api/cover';
import { createExpoEpubDeliveryClient } from './src/api/epubDeliveryRuntime';
import {
  EpubDeliveryError,
  type EpubDeliveryClient,
  type EpubDownloadTask,
} from './src/api/epubDelivery';
import { resolveEnvironment } from './src/config/environment';
import { useLibrary } from './src/library/useLibrary';
import type { LibraryBook, LibraryRepository } from './src/library/types';
import { LibraryScreen } from './src/screens/LibraryScreen';
import { FindBookScreen } from './src/screens/FindBookScreen';
import { BookConfirmationScreen, type Acquisition } from './src/screens/BookConfirmationScreen';
import { ScannerScreen } from './src/scanner/ScannerScreen';
import { notices } from './src/reader/vendor/notices';
import { ReaderScreen } from './src/reader/ReaderScreen';
import { Button, Copy, Cover, EmptyMessage, Skeleton } from './src/components/UI';
import { Sheet } from './src/components/Sheet';
import { Navigation, type Tab } from './src/components/Navigation';
import { demoScenario, demoMetadata, demoEditions, demoScanner } from './src/dev/browserDemo';
import { colors } from './src/ui/theme';
import { useReducedMotionStatus } from './src/ui/useReducedMotion';

const environment = resolveEnvironment({
  EXPO_PUBLIC_APP_ENV: process.env.EXPO_PUBLIC_APP_ENV,
  EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
});
const liveMetadata = createMetadataClient({
  baseUrl: environment.apiUrl,
  fetcher: fetch,
  timeoutMs: 20000,
});
const liveEditions = createEditionClient({
  baseUrl: environment.apiUrl,
  fetcher: fetch,
  timeoutMs: 95000,
});
const liveCover = createExpoCoverClient(environment.apiUrl);
let delivery: EpubDeliveryClient | undefined;
export type AppProps = {
  metadataClient?: MetadataClient;
  coverClient?: CoverClient;
  editionClient?: EditionClient;
  epubDeliveryClient?: EpubDeliveryClient;
  repository?: LibraryRepository;
};
type Route = 'library' | 'scan' | 'search' | 'confirm' | 'reader' | 'settings';

export default function App(props: AppProps = {}) {
  const [fontsLoaded, fontError] = useFonts({
    InstrumentSans_400Regular,
    InstrumentSans_500Medium,
    InstrumentSans_600SemiBold,
    InstrumentSans_700Bold,
  });
  const library = useLibrary(props.repository);
  const [showNotices, setShowNotices] = useState(false);
  const [route, setRoute] = useState<Route>('library');
  const [candidates, setCandidates] = useState<MetadataCandidate[]>([]),
    [candidate, setCandidate] = useState<MetadataCandidate | null>(null);
  const [fromScan, setFromScan] = useState(false);
  const [readerOpening, setReaderOpening] = useState(false);
  const [readerReady, setReaderReady] = useState(false);
  const readerFade = useRef(new Animated.Value(1)).current;
  const { isReady: motionReady, reducedMotion } = useReducedMotionStatus();
  useEffect(() => {
    if (!readerOpening || !readerReady) return;
    if (!motionReady || reducedMotion) {
      setReaderOpening(false);
      return;
    }
    const animation = Animated.timing(readerFade, {
      toValue: 0,
      duration: 480,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (finished) setReaderOpening(false);
    });
    return () => animation.stop();
  }, [readerOpening, readerReady, readerFade, motionReady, reducedMotion]);
  const [searchBusy, setSearchBusy] = useState(false),
    [searchError, setSearchError] = useState<string | null>(null),
    [partial, setPartial] = useState(false);
  const [acquisition, setAcquisition] = useState<Acquisition>({
    stage: 'confirm',
  });
  const [selectedId, setSelectedId] = useState<string | null>(null),
    [details, setDetails] = useState<LibraryBook | null>(null),
    [confirmDelete, setConfirmDelete] = useState(false);
  const [notice, setNotice] = useState<string | null>(null),
    [importing, setImporting] = useState(false);
  const operation = useRef(0),
    abort = useRef<AbortController | null>(null),
    download = useRef<EpubDownloadTask | null>(null),
    importLock = useRef(false);
  const metadata = props.metadataClient ?? (demoScenario ? demoMetadata : liveMetadata);
  const editions = props.editionClient ?? (demoScenario ? demoEditions : liveEditions);
  const getDelivery = () =>
    props.epubDeliveryClient ?? (delivery ??= createExpoEpubDeliveryClient(environment.apiUrl));
  const cancel = () => {
    setReaderOpening(false);
    setReaderReady(false);
    operation.current++;
    abort.current?.abort();
    abort.current = null;
    void download.current?.cancel().catch(() => undefined);
    download.current = null;
    setSearchBusy(false);
  };
  useEffect(
    () => () => {
      operation.current++;
      abort.current?.abort();
      void download.current?.cancel().catch(() => undefined);
    },
    [],
  );
  const navigate = (next: Route) => {
    cancel();
    setRoute(next);
  };
  const choose = (value: MetadataCandidate, scanned = false) => {
    setFromScan(scanned);
    cancel();
    setCandidate(value);
    setAcquisition({ stage: 'confirm' });
    setRoute('confirm');
  };
  const showMatches = (
    result: { candidates: MetadataCandidate[]; providerFailures: string[] },
    scanned = false,
  ) => {
    setCandidates(result.candidates);
    setPartial(result.providerFailures.length > 0);
    setSearchBusy(false);
    if (result.candidates.length === 1 && result.candidates[0].confidence === 'high')
      choose(result.candidates[0], scanned);
    else {
      setSearchError(
        result.candidates.length
          ? null
          : 'No match yet. Try the title and author, or scan the barcode.',
      );
      setRoute('search');
    }
  };
  const search = async (query: MetadataQuery) => {
    cancel();
    const current = operation.current,
      controller = new AbortController();
    abort.current = controller;
    setRoute('search');
    setSearchBusy(true);
    setSearchError(null);
    setCandidates([]);
    setPartial(false);
    try {
      const result = await metadata.search(query, controller.signal);
      if (current === operation.current) showMatches(result);
    } catch (error) {
      if (current === operation.current) {
        setSearchError(message(error));
        setSearchBusy(false);
      }
    }
  };
  const recognize = (result: CoverRecognitionResult, preview?: string) =>
    showMatches(
      preview && result.status === 'matched' && result.candidates.length === 1
        ? {
            ...result,
            candidates: result.candidates.map((item) => ({
              ...item,
              edition: { ...item.edition, coverUrl: preview },
            })),
          }
        : result,
      true,
    );
  const resolve = async () => {
    if (!candidate) return;
    cancel();
    const current = operation.current,
      controller = new AbortController();
    abort.current = controller;
    setAcquisition({ stage: 'finding' });
    try {
      const result = await editions.resolve(requestForCandidate(candidate), controller.signal);
      if (current !== operation.current) return;
      if (result.status === 'ready') await save(result);
      else setAcquisition({ stage: 'unavailable', result });
    } catch (error) {
      if (current === operation.current) setAcquisition({ stage: 'error', error: message(error) });
    }
  };
  const save = async (result: EditionResolutionResult) => {
    if (!result.delivery || !result.digitalEdition) {
      setAcquisition({
        stage: 'error',
        error: 'This edition could not be downloaded. Please try again.',
      });
      return;
    }
    if (importLock.current) {
      setAcquisition({
        stage: 'error',
        result,
        error: 'Another book is still being saved. Please try again in a moment.',
      });
      return;
    }
    importLock.current = true;
    const current = operation.current;
    let uri: string | undefined;
    setAcquisition({ stage: 'saving', result, progress: 0 });
    try {
      if (demoScenario) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        if (demoScenario === 'download-error')
          throw new Error('The download was interrupted. Try again when your connection is back.');
        uri = '/demo/pride-and-prejudice.epub';
      } else {
        const task = getDelivery().createDownload(result.delivery, (progress) => {
          if (current === operation.current)
            setAcquisition({
              stage: 'saving',
              result,
              progress: progress.fraction ?? undefined,
            });
        });
        download.current = task;
        uri = (await task.start()).uri;
      }
      if (current !== operation.current) return;
      const book = await library.repository.importFile(uri, {
        title: result.digitalEdition.title,
        authors: result.digitalEdition.authors,
        ...(result.source && result.rights
          ? {
              source: {
                name: result.source.organization,
                url: result.source.canonicalUrl,
                license: result.rights.licenseName,
                attribution: result.rights.attribution,
              },
            }
          : {}),
      });
      library.upsert(book);
      if (current !== operation.current) return;
      await library.update(book.id, { openedAt: new Date().toISOString() });
      if (current === operation.current) {
        setSelectedId(book.id);
        setAcquisition({ stage: 'opening' });
        readerFade.setValue(1);
        setReaderReady(false);
        setReaderOpening(true);
        setRoute('reader');
      }
    } catch (error) {
      if (current === operation.current)
        setAcquisition({
          stage: 'error',
          result:
            error instanceof EpubDeliveryError && error.code === 'expired' ? undefined : result,
          error: message(error),
        });
    } finally {
      importLock.current = false;
      download.current = null;
      if (uri && !demoScenario)
        await getDelivery()
          .cleanup(uri)
          .catch(() => undefined);
    }
  };
  const importBook = async () => {
    if (importLock.current) return;
    importLock.current = true;
    let importUri: string | undefined;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: Platform.OS === 'ios' ? ['application/epub+zip'] : ['application/epub+zip', '.epub'],
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      importUri = result.assets[0].uri;
      setImporting(true);
      setRoute('library');
      const book = await library.repository.importFile(result.assets[0].uri);
      library.upsert(book);
      setSelectedId(book.id);
      setDetails(book);
    } catch (error) {
      setNotice(message(error));
    } finally {
      importLock.current = false;
      setImporting(false);
      if (importUri && Platform.OS !== 'web')
        await FileSystem.deleteAsync(importUri, { idempotent: true }).catch(() => undefined);
    }
  };
  const open = async (book: LibraryBook) => {
    try {
      await library.update(book.id, { openedAt: new Date().toISOString() });
      setSelectedId(book.id);
      setDetails(null);
      setRoute('reader');
    } catch {
      setNotice('Your book could not be opened. Try again.');
    }
  };
  const selected = library.books.find((book) => book.id === selectedId);
  if (!fontsLoaded && !fontError)
    return (
      <SafeAreaView style={s.screen}>
        <View style={{ padding: 30, gap: 24 }}>
          <Skeleton width="55%" height={40} />
          <Skeleton height={230} radius={28} />
        </View>
      </SafeAreaView>
    );
  return (
    <View style={[s.screen, readerOpening && { backgroundColor: 'white' }]}>
      <StatusBar style="dark" />
      {route === 'library' ? (
        <LibraryScreen
          books={library.books}
          loading={library.loading}
          error={library.error}
          importing={importing}
          onOpen={(book) => void open(book)}
          onScan={() => navigate('scan')}
          onImport={() => void importBook()}
          onDetails={(book) => {
            setDetails(book);
            setConfirmDelete(false);
          }}
          onRetry={() => void library.reload()}
          onFind={(query) =>
            query.trim() ? void search({ title: query.trim() }) : navigate('search')
          }
        />
      ) : null}
      {route === 'scan' ? (
        <ScannerScreen
          fixture={demoScenario ? demoScanner : undefined}
          onBack={() => navigate('library')}
          onCoverRecognized={recognize}
          onIsbnAccepted={(isbn) => void search({ isbn })}
          onManualSearch={() => navigate('search')}
          coverClient={props.coverClient ?? liveCover}
        />
      ) : null}
      {route === 'search' ? (
        <FindBookScreen
          candidates={candidates}
          busy={searchBusy}
          error={searchError}
          partial={partial}
          onSearch={(query) => void search(query)}
          onChoose={choose}
          onBack={() => navigate('library')}
        />
      ) : null}
      {(route === 'confirm' || (route === 'reader' && readerOpening)) && candidate ? (
        <Animated.View
          testID={readerOpening ? 'reader-transition' : 'book-confirmation'}
          accessibilityViewIsModal
          style={[
            StyleSheet.absoluteFill,
            {
              zIndex: 2,
              opacity: readerOpening
                ? readerFade.interpolate({ inputRange: [0, 0.55, 1], outputRange: [0, 0, 1] })
                : 1,
            },
          ]}
        >
          <BookConfirmationScreen
            key={candidate.candidateId}
            candidate={candidate}
            acquisition={acquisition}
            fromScan={fromScan}
            onBack={() => navigate('search')}
            onConfirm={() => void resolve()}
            onRetry={() =>
              void (acquisition.result?.delivery ? save(acquisition.result) : resolve())
            }
            onImport={() => void importBook()}
          />
        </Animated.View>
      ) : null}
      {route === 'reader' && selected ? (
        <Animated.View
          testID="reader-page"
          style={{
            flex: 1,
            opacity: readerOpening && readerReady
              ? readerFade.interpolate({ inputRange: [0, 0.45, 1], outputRange: [1, 0, 0] })
              : 1,
          }}
          pointerEvents={readerOpening ? 'none' : 'auto'}
          accessibilityElementsHidden={readerOpening}
          aria-hidden={readerOpening}
          importantForAccessibility={readerOpening ? 'no-hide-descendants' : 'auto'}
        >
          <ReaderScreen
            key={selected.id}
            book={selected}
            preferences={library.preferences}
            onPreferences={library.setPreferences}
            onUpdate={(patch) => library.update(selected.id, patch)}
            onClose={() => navigate('library')}
            onReady={() => setReaderReady(true)}
            onLoadError={() => setReaderOpening(false)}
          />
        </Animated.View>
      ) : null}
      {route === 'settings' ? (
        <SafeAreaView style={s.screen}>
          <ScrollView contentContainerStyle={s.settings}>
            <Copy weight="semibold" style={s.title}>
              Settings
            </Copy>
            <View style={s.card}>
              <Copy weight="semibold" style={{ fontSize: 21 }}>
                Your library
              </Copy>
              <Copy style={s.body}>
                Books, bookmarks, and progress stay on this device. Read offline. No account needed.
              </Copy>
              <Button
                title="Import an EPUB"
                secondary
                icon="upload"
                onPress={() => void importBook()}
              />
            </View>
            <View style={s.card}>
              <Copy weight="semibold" style={{ fontSize: 21 }}>
                Discovery & privacy
              </Copy>
              <Copy style={s.body}>
                We find openly available editions using U.S. availability. Some books won’t have an
                open copy.
              </Copy>
              <Copy style={s.body}>
                A cover photo is sent to the book service for recognition and discarded after the
                request. Your library stays private on your device.
              </Copy>
            </View>
            <View style={s.card}>
              <Copy weight="semibold">Credits</Copy>
              <Copy style={s.body}>
                EPUB reading powered by epub.js and JSZip. Instrument Sans by Instrument. Their
                open-source licenses are included with the app.
              </Copy>
              <Button title="Open-source licenses" secondary onPress={() => setShowNotices(true)} />
            </View>
            {demoScenario ? (
              <Copy style={s.body}>
                Browser demo · {demoScenario}. Scans and discovery are simulated. Library storage
                and EPUB reading are real.
              </Copy>
            ) : null}
          </ScrollView>
        </SafeAreaView>
      ) : null}
      {route === 'library' || route === 'settings' ? (
        <Navigation selected={route as Tab} onSelect={(tab) => navigate(tab)} />
      ) : null}
      {demoScenario && route !== 'reader' ? (
        <View pointerEvents="none" style={s.demo}>
          <Copy style={{ fontSize: 9, color: colors.mutedInk }}>
            BROWSER DEMO · {demoScenario.toUpperCase()}
          </Copy>
        </View>
      ) : null}
      <Sheet
        visible={!!details}
        title={confirmDelete ? 'Remove this book?' : 'On your shelf'}
        onClose={() => {
          setDetails(null);
          setConfirmDelete(false);
        }}
      >
        {details ? (
          <>
            <View style={{ alignItems: 'center', gap: 18, paddingVertical: 12 }}>
              <Cover uri={details.coverUri} title={details.title} width={110} />
              <Copy weight="semibold" style={{ fontSize: 24, textAlign: 'center' }}>
                {details.title}
              </Copy>
              <Copy style={s.body}>{details.authors.join(', ')}</Copy>
            </View>
            {confirmDelete ? (
              <>
                <Copy style={s.body}>
                  This removes the downloaded book, bookmarks, and reading position from this
                  device.
                </Copy>
                <Button
                  title="Remove from library"
                  onPress={() => {
                    void library
                      .remove(details.id)
                      .then(() => {
                        setDetails(null);
                        setConfirmDelete(false);
                      })
                      .catch(() => setNotice('The book could not be removed. Please try again.'));
                  }}
                />
                <Button title="Keep book" secondary onPress={() => setConfirmDelete(false)} />
              </>
            ) : (
              <>
                <Button title="Read book" icon="arrow-right" onPress={() => void open(details)} />
                {details.source ? (
                  <>
                    <Copy style={s.body}>
                      {details.source.name} · {details.source.license}
                    </Copy>
                    {details.source.attribution ? (
                      <Copy style={s.body}>{details.source.attribution}</Copy>
                    ) : null}
                    <Button
                      title="View edition source"
                      secondary
                      onPress={() => {
                        if (/^https:\/\//.test(details.source!.url))
                          void Linking.openURL(details.source!.url).catch(() =>
                            setNotice('The source could not be opened.'),
                          );
                      }}
                    />
                  </>
                ) : null}
                <Button title="Remove book" secondary onPress={() => setConfirmDelete(true)} />
              </>
            )}
          </>
        ) : null}
      </Sheet>
      <Sheet
        visible={showNotices}
        title="Open-source licenses"
        onClose={() => setShowNotices(false)}
      >
        {notices.map((item) => (
          <View key={item.name} style={{ gap: 12 }}>
            <Copy weight="semibold">{item.name}</Copy>
            <Copy style={{ fontSize: 12, lineHeight: 18 }}>{item.text}</Copy>
          </View>
        ))}
      </Sheet>
      <Sheet visible={!!notice} title="Something needs another try" onClose={() => setNotice(null)}>
        <Copy style={s.body}>{notice}</Copy>
        <Button title="Got it" onPress={() => setNotice(null)} />
      </Sheet>
    </View>
  );
}
function message(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  settings: {
    padding: 24,
    paddingBottom: 130,
    gap: 22,
    width: '100%',
    maxWidth: 620,
    alignSelf: 'center',
  },
  title: { fontSize: 30, letterSpacing: -1 },
  eyebrow: {
    fontSize: 10,
    letterSpacing: 1.5,
    color: colors.mutedInk,
    marginTop: 12,
  },
  body: { color: colors.mutedInk, lineHeight: 24, fontSize: 15 },
  card: { padding: 24, backgroundColor: 'white', borderRadius: 28, gap: 15 },
  demo: { position: 'absolute', top: 2, alignSelf: 'center' },
});
