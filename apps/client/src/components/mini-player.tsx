import { router } from 'expo-router';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';

import { Artwork } from './artwork';
import { HighlightButton } from './highlights';
import { IconButton } from './icon';
import { SeekBar } from './scrubber';
import { ThemedText } from './themed-text';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useWindowWidth } from '@/hooks/use-window-width';
import { formatClock } from '@/lib/format';
import { usePlayer } from '@/player/store';

/** Wide web windows have room for a desktop-style seek bar with times in the middle of the bar. */
const INLINE_SEEK_MIN_WIDTH = 720;

/** Persistent now-playing bar. Renders nothing until something has been played. */
export function MiniPlayer({ compact = false }: { compact?: boolean }) {
  const theme = useTheme();
  const windowWidth = useWindowWidth();
  const inlineSeek = Platform.OS === 'web' && !compact && windowWidth >= INLINE_SEEK_MIN_WIDTH;
  const current = usePlayer((s) => s.current);
  const playing = usePlayer((s) => s.playing);
  const fraction = usePlayer((s) => (s.durationSec ? Math.min(1, s.positionSec / s.durationSec) : 0));
  const buffering = usePlayer((s) => s.buffering);
  const skipBackSec = usePlayer((s) => s.skipBackSec);
  const { togglePlay, skipBack } = usePlayer.getState();

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
      {/* Skip back, highlight, then play / pause at the right edge, where the thumb rests. */}
      {!compact && <IconButton name={`skipBack${skipBackSec}`} label={`Skip back ${skipBackSec} seconds`} onPress={skipBack} />}
      {!compact && <HighlightButton source="miniPlayer" variant="icon" />}
      {buffering && !playing ? (
        <View style={styles.spinner}>
          <ActivityIndicator accessibilityLabel="Loading" />
        </View>
      ) : (
        <IconButton name={playing ? 'pause' : 'play'} label={playing ? 'Pause' : 'Play'} onPress={togglePlay} />
      )}
      {/* Phones show a thin progress line along the bottom, inset from the corners; seeking is in
          the full player. The web bar keeps a seek bar along its top edge. */}
      {Platform.OS !== 'web' || compact ? (
        <View style={[styles.progressTrack, { backgroundColor: theme.backgroundSelected }]}>
          <View style={[styles.progress, { width: `${fraction * 100}%`, backgroundColor: theme.text }]} />
        </View>
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
  progressTrack: { position: 'absolute', left: Spacing.two, right: Spacing.two, bottom: 2, height: 2, borderRadius: 1, overflow: 'hidden' },
  progress: { height: '100%' },
  spinner: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  // On web the bar straddles the top edge, leaving room above it for the thumb and time.
  edgeSeek: { position: 'absolute', left: 0, right: 0, top: -8 },
  inlineSeek: { flex: 2, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginHorizontal: Spacing.three },
  inlineBar: { flex: 1 },
  time: { minWidth: 44, textAlign: 'center', fontVariant: ['tabular-nums'] },
});
