import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Cover } from './UI';

// The scan and confirmation share these dimensions so the cover never jumps between screens.
export const bookHeroTop = 107;
export const bookHeroWidth = (height: number) =>
  Math.round(Math.max(132, Math.min(180, (height - 300) / 3)));
export const bookPerspective = [{ perspective: 900 }, { rotateY: '-18deg' }, { rotateZ: '-2deg' }];

export function BookObject({
  uri,
  title,
  author,
  width,
}: {
  uri?: string | null;
  title: string;
  author?: string;
  width: number;
}) {
  return (
    <View style={{ width, height: width * 1.5 }}>
      <View pointerEvents="none" style={[s.back, { height: width * 1.5 - 2 }]} />
      <LinearGradient
        pointerEvents="none"
        colors={['#DEDCD5', '#FAF9F5', '#D8D6CE']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={[s.pages, { height: width * 1.5 - 10 }]}
      >
        {[2, 5, 8].map((left) => (
          <View key={left} style={[s.pageEdge, { left }]} />
        ))}
      </LinearGradient>
      <Cover uri={uri} title={title} author={author} width={width} />
    </View>
  );
}
const s = StyleSheet.create({
  back: {
    position: 'absolute',
    top: 3,
    right: -12,
    width: 22,
    borderRadius: 4,
    backgroundColor: '#34403C',
  },
  pages: {
    position: 'absolute',
    top: 6,
    right: -10,
    width: 15,
    borderTopRightRadius: 3,
    borderBottomRightRadius: 3,
  },
  pageEdge: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: '#B7B4A926' },
});
