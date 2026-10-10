import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Artwork } from '@/components/artwork';
import { IconButton } from '@/components/icon';
import { HighlightButton } from '@/components/highlights';
import { Scrubber } from '@/components/scrubber';
import { ShareButton } from '@/components/share-button';
import { SleepTimerButton, SleepTimerOptions } from '@/components/sleep-timer';
import { SpeedButton, SpeedOptions } from '@/components/speed';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { usePlayer } from '@/player/store';

export default function PlayerScreen() {
  const theme = useTheme();
  const safe = useSafeAreaInsets();
  // Smaller artwork on short phones (e.g. iPhone mini) so the controls fit without scrolling.
  const artworkSize = Math.round(Math.min(280, Math.max(160, useWindowDimensions().height - 600)));
  const current = usePlayer((s) => s.current);
  const playing = usePlayer((s) => s.playing);
  const buffering = usePlayer((s) => s.buffering);
  const error = usePlayer((s) => s.error);
  const skipBackSec = usePlayer((s) => s.skipBackSec);
  const skipForwardSec = usePlayer((s) => s.skipForwardSec);
  const { togglePlay, skipBack, skipForward } = usePlayer.getState();
  // One options panel at a time: speed or the sleep timer.
  const [panel, setPanel] = useState<'speed' | 'sleep' | null>(null);
  const toggle = (which: 'speed' | 'sleep') => setPanel((open) => (open === which ? null : which));

  // Nothing to show (e.g. a deep link to /player before anything played).
  useEffect(() => {
    if (!current && router.canGoBack()) router.back();
  }, [current]);

  if (!current) return <ThemedView style={styles.fill} />;

  return (
    <ThemedView style={styles.fill}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: safe.bottom + Spacing.five }]}>
        <Artwork uri={current.artworkUrl} size={artworkSize} />
        <View style={styles.titles}>
          <ThemedText type="smallBold" style={styles.title} numberOfLines={3} accessibilityRole="header">
            {current.title}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {current.podcastTitle}
          </ThemedText>
        </View>

        <View style={styles.scrubber}>
          <Scrubber />
        </View>

        <View style={styles.controls}>
          <IconButton name={`skipBack${skipBackSec}`} label={`Skip back ${skipBackSec} seconds`} size={30} onPress={skipBack} />
          <View style={[styles.playButton, { backgroundColor: theme.tint }]}>
            {buffering && !playing ? (
              <ActivityIndicator color={theme.background} accessibilityLabel="Loading" />
            ) : (
              <IconButton
                name={playing ? 'pause' : 'play'}
                label={playing ? 'Pause' : 'Play'}
                size={36}
                color={theme.background}
                onPress={togglePlay}
              />
            )}
          </View>
          <IconButton name={`skipForward${skipForwardSec}`} label={`Skip forward ${skipForwardSec} seconds`} size={30} onPress={skipForward} />
        </View>

        <View style={styles.secondary}>
          <SpeedButton open={panel === 'speed'} onPress={() => toggle('speed')} />
          <SleepTimerButton open={panel === 'sleep'} onPress={() => toggle('sleep')} />
          <HighlightButton source="player" variant="pill" />
          <ShareButton episode={current} />
        </View>
        {panel === 'speed' && <SpeedOptions />}
        {panel === 'sleep' && <SleepTimerOptions onChoose={() => setPanel(null)} />}

        {error && (
          <ThemedText type="small" style={{ color: theme.danger }} accessibilityLiveRegion="polite">
            {error}
          </ThemedText>
        )}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { alignItems: 'center', padding: Spacing.four, gap: Spacing.four },
  titles: { alignItems: 'center', gap: Spacing.one, maxWidth: 480 },
  title: { fontSize: 20, lineHeight: 26, textAlign: 'center' },
  scrubber: { width: '100%', maxWidth: 480 },
  controls: { flexDirection: 'row', alignItems: 'center', gap: Spacing.five },
  playButton: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  secondary: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: Spacing.three },
});
