import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Artwork } from '@/components/artwork';
import { IconButton } from '@/components/icon';
import { Scrubber } from '@/components/scrubber';
import { SleepTimerButton, SleepTimerOptions } from '@/components/sleep-timer';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { usePlayer } from '@/player/store';

export default function PlayerScreen() {
  const theme = useTheme();
  const safe = useSafeAreaInsets();
  const current = usePlayer((s) => s.current);
  const playing = usePlayer((s) => s.playing);
  const buffering = usePlayer((s) => s.buffering);
  const error = usePlayer((s) => s.error);
  const rate = usePlayer((s) => s.rate);
  const skipBackSec = usePlayer((s) => s.skipBackSec);
  const skipForwardSec = usePlayer((s) => s.skipForwardSec);
  const { togglePlay, skipBack, skipForward, cycleRate } = usePlayer.getState();
  const [sleepOptionsOpen, setSleepOptionsOpen] = useState(false);

  // Nothing to show (e.g. a deep link to /player before anything played).
  useEffect(() => {
    if (!current && router.canGoBack()) router.back();
  }, [current]);

  if (!current) return <ThemedView style={styles.fill} />;

  return (
    <ThemedView style={styles.fill}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: safe.bottom + Spacing.five }]}>
        <Artwork uri={current.artworkUrl} size={280} />
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
          <IconButton name="skipBack" label={`Skip back ${skipBackSec} seconds`} size={30} onPress={skipBack} />
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
          <IconButton name="skipForward" label={`Skip forward ${skipForwardSec} seconds`} size={30} onPress={skipForward} />
        </View>

        <View style={styles.secondary}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Playback speed ${rate}x. Change speed`}
            onPress={cycleRate}
            style={({ pressed }) => [styles.rate, { backgroundColor: theme.backgroundElement }, pressed && styles.pressed]}>
            <ThemedText type="smallBold">{`${rate}x`}</ThemedText>
          </Pressable>
          <SleepTimerButton open={sleepOptionsOpen} onPress={() => setSleepOptionsOpen((open) => !open)} />
        </View>
        {sleepOptionsOpen && <SleepTimerOptions onChoose={() => setSleepOptionsOpen(false)} />}

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
  rate: { minWidth: 64, minHeight: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.three },
  pressed: { opacity: 0.6 },
});
