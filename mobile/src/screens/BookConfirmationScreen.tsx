import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { MetadataCandidate } from '../api/metadata';
import type { EditionResolutionResult } from '../api/editions';
import { Button, Copy, IconButton, Skeleton } from '../components/UI';
import { BookObject, bookHeroWidth, bookPerspective } from '../components/BookObject';
import { Entrance } from '../ui/Entrance';
import { colors } from '../ui/theme';

export type Acquisition = {
  stage: 'confirm' | 'finding' | 'saving' | 'opening' | 'unavailable' | 'error';
  result?: EditionResolutionResult;
  progress?: number;
  error?: string;
};
export function BookConfirmationScreen({
  candidate,
  acquisition,
  fromScan = false,
  onBack,
  onConfirm,
  onRetry,
  onImport,
}: {
  candidate: MetadataCandidate;
  acquisition: Acquisition;
  fromScan?: boolean;
  onBack(): void;
  onConfirm(): void;
  onRetry(): void;
  onImport(): void;
}) {
  const { height } = useWindowDimensions();
  const { stage } = acquisition;
  const waiting = stage === 'finding' || stage === 'saving' || stage === 'opening';
  const hero = (
    <View testID="confirmed-book" style={[s.hero, { transform: bookPerspective }]}>
      <BookObject
        uri={candidate.edition.coverUrl}
        title={candidate.work.title}
        author={candidate.work.authors[0]}
        width={bookHeroWidth(height)}
      />
    </View>
  );
  return (
    <SafeAreaView style={s.screen}>
      <ScrollView contentContainerStyle={s.content}>
        <View style={s.header}>
          <IconButton
            name="chevron-left"
            label={waiting ? 'Cancel and go back' : 'Back to matches'}
            onPress={onBack}
          />
          <View style={{ width: 46 }} />
        </View>
        {fromScan ? hero : <Entrance distance={12}>{hero}</Entrance>}
        <Entrance distance={8}>
          <View style={s.identity}>
            {stage === 'confirm' ? <Copy style={s.subtitle}>Is this your book?</Copy> : null}
            <Copy weight="semibold" style={s.title}>
              {candidate.work.title}
            </Copy>
            <Copy style={s.author}>{candidate.work.authors.join(', ') || 'Unknown author'}</Copy>
          </View>
        </Entrance>
        <Entrance key={waiting ? 'preparing' : stage} distance={6}>
          <View style={s.actions}>
            {stage === 'confirm' ? (
              <>
                {candidate.confidence === 'low' ? (
                  <Copy style={s.body}>Possible match. Check the title and author.</Copy>
                ) : null}
                <Button title="Yes, this is my book" icon="arrow-right" onPress={onConfirm} />
                <Button title="Not this book" secondary onPress={onBack} />
              </>
            ) : null}
            {waiting ? (
              <View accessibilityLiveRegion="polite" style={s.info}>
                <Copy weight="medium">
                  {stage === 'opening' ? 'Opening your book…' : 'Preparing your book…'}
                </Copy>
                <Skeleton height={4} />
                {stage !== 'opening' ? (
                  <Copy style={s.small}>
                    {stage === 'finding'
                      ? 'This may take a minute.'
                      : acquisition.progress
                        ? `${Math.round(acquisition.progress * 100)}%`
                        : 'Available offline once saved.'}
                  </Copy>
                ) : null}
              </View>
            ) : null}
            {stage === 'unavailable' ? (
              <>
                <View style={s.info}>
                  <Copy weight="medium">No open edition available</Copy>
                  <Copy style={s.small}>You can still import an EPUB you own.</Copy>
                </View>
                <Button title="Import my EPUB" icon="upload" onPress={onImport} />
                <Button title="Try another book" secondary onPress={onBack} />
              </>
            ) : null}
            {stage === 'error' ? (
              <>
                <Copy accessibilityRole="alert" style={s.body}>
                  {acquisition.error}
                </Copy>
                <Button title="Try again" onPress={onRetry} />
                <Button title="Back to matches" secondary onPress={onBack} />
              </>
            ) : null}
          </View>
        </Entrance>
      </ScrollView>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'white' },
  content: {
    padding: 24,
    paddingBottom: 40,
    gap: 15,
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 46,
  },
  subtitle: { fontSize: 15, color: colors.mutedInk },
  hero: { alignSelf: 'center', marginTop: 22, marginBottom: 24 },
  identity: { alignItems: 'center', gap: 8 },
  title: { fontSize: 26, lineHeight: 32, letterSpacing: -0.7, textAlign: 'center' },
  author: { fontSize: 16, color: colors.mutedInk, textAlign: 'center' },
  actions: { gap: 8, paddingTop: 20 },
  body: { color: colors.mutedInk, lineHeight: 23, textAlign: 'center', marginBottom: 12 },
  small: { fontSize: 13, lineHeight: 20, color: colors.mutedInk },
  info: {
    backgroundColor: colors.canvas,
    padding: 20,
    borderRadius: 22,
    gap: 10,
    marginBottom: 16,
  },
});
