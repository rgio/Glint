import { router } from 'expo-router';
import { Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { Artwork } from './artwork';
import { IconButton } from './icon';
import { SeekBar } from './scrubber';
import { ThemedText } from './themed-text';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatClock } from '@/lib/format';
import { usePlayer } from '@/player/store';

/** Wide web windows have room for a desktop-style seek bar with times in the middle of the bar. */
const INLINE_SEEK_MIN_WIDTH = 720;

/** Persistent now-playing bar. Renders nothing until something has been played. */
export function MiniPlayer({ compact = false }: { compact?: boolean }) {
  const theme = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const inlineSeek = Platform.OS === 'web' && !compact && windowWidth >= INLINE_SEEK_MIN_WIDTH;
  const current = usePlayer((s) => s.current);
  const playing = usePlayer((s) => s.playing);
  const fraction = usePlayer((s) => (s.durationSec ? Math.min(1, s.positionSec / s.durationSec) : 0));
  const { togglePlay, skipForward } = usePlayer.getState();

  if (!current) return null;

  return (
    <View style={styles.container}>
      <Pressable
        style={styles.body}
        accessibilityRole="button"
        accessibilityLabel={`Now playing: ${current.title}. Open player`}
        onPress={() => router.push('/player')}>
        {!compact && <Artwork uri={current.artworkUrl} size={40} />}
        <View style={styles.text}>
          <ThemedText type="smallBold" numberOfLines={1}>
            {current.title}
          </ThemedText>
          {!compact && (
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {current.podcastTitle}
            </ThemedText>
          )}
        </View>
      </Pressable>
      {inlineSeek && <InlineSeek />}
      <IconButton name={playing ? 'pause' : 'play'} label={playing ? 'Pause' : 'Play'} onPress={togglePlay} />
      {!compact && <IconButton name="skipForward" label="Skip forward" onPress={skipForward} />}
      {compact ? (
        <View style={[styles.progress, { width: `${fraction * 100}%`, backgroundColor: theme.tint }]} />
      ) : (
        !inlineSeek && <SeekBar trackHeight={3} hitHeight={16} style={styles.edgeSeek} />
      )}
    </View>
  );
}

function InlineSeek() {
  const positionSec = usePlayer((s) => s.positionSec);
  const durationSec = usePlayer((s) => s.durationSec);
  return (
    <View style={styles.inlineSeek}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.time}>
        {formatClock(positionSec)}
      </ThemedText>
      <SeekBar hitHeight={24} style={styles.inlineBar} />
      <ThemedText type="small" themeColor="textSecondary" style={styles.time}>
        {durationSec ? `-${formatClock(durationSec - positionSec)}` : '--:--'}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    gap: Spacing.one,
  },
  body: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  text: { flex: 1 },
  progress: { position: 'absolute', left: 0, bottom: 0, height: 2 },
  // On web the bar straddles the top edge, leaving room above it for the thumb and time;
  // native keeps it inside the bottom of the card, which clips its overflow.
  edgeSeek: Platform.select({
    web: { position: 'absolute', left: 0, right: 0, top: -8 },
    default: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  }),
  inlineSeek: { flex: 2, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginHorizontal: Spacing.three },
  inlineBar: { flex: 1 },
  time: { minWidth: 44, textAlign: 'center', fontVariant: ['tabular-nums'] },
});
