import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Animated, PanResponder, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Artwork } from '@/components/artwork';
import { HighlightButton } from '@/components/highlights';
import { IconButton } from '@/components/icon';
import { Scrubber } from '@/components/scrubber';
import { ShareButton } from '@/components/share-button';
import { SleepTimerMenu } from '@/components/sleep-timer';
import { SpeedMenu } from '@/components/speed';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { usePlayer } from '@/player/store';

const MAX_ARTWORK = 340;
/** How far down the top of the player has to be dragged to close it. */
const CLOSE_DRAG = 120;

const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

/**
 * The full player. It fits the screen without scrolling (the artwork takes what room is left),
 * so dragging the seek bar never scrolls the page. Close it with the chevron or by dragging the
 * top half down.
 */
export default function PlayerScreen() {
  const theme = useTheme();
  const safe = useSafeAreaInsets();
  const current = usePlayer((s) => s.current);
  const playing = usePlayer((s) => s.playing);
  const buffering = usePlayer((s) => s.buffering);
  const error = usePlayer((s) => s.error);
  const skipBackSec = usePlayer((s) => s.skipBackSec);
  const skipForwardSec = usePlayer((s) => s.skipForwardSec);
  const { togglePlay, skipBack, skipForward } = usePlayer.getState();
  const [artworkSize, setArtworkSize] = useState(0);

  const [drag] = useState(() => new Animated.Value(0));
  const [swipeDown] = useState(() =>
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => g.dy > 8 && Math.abs(g.dy) > Math.abs(g.dx) * 2,
      onPanResponderMove: (_, g) => drag.setValue(Math.max(0, g.dy)),
      onPanResponderRelease: (_, g) => {
        if (g.dy > CLOSE_DRAG || g.vy > 1) close();
        else Animated.spring(drag, { toValue: 0, useNativeDriver: true }).start();
      },
      onPanResponderTerminate: () => Animated.spring(drag, { toValue: 0, useNativeDriver: true }).start(),
    }),
  );

  // Nothing to show (e.g. a deep link to /player before anything played).
  useEffect(() => {
    if (!current && router.canGoBack()) router.back();
  }, [current]);

  if (!current) return <ThemedView style={styles.fill} />;

  return (
    <Animated.View style={[styles.fill, { transform: [{ translateY: drag }] }]}>
      <ThemedView style={[styles.fill, { paddingTop: safe.top, paddingBottom: safe.bottom + Spacing.three }]}>
        <View {...swipeDown.panHandlers} style={styles.top}>
          <View style={styles.topBar}>
            <IconButton name="collapse" label="Close player" size={26} onPress={close} />
            <ThemedText type="smallBold" themeColor="textSecondary" style={styles.topTitle} numberOfLines={1}>
              Now Playing
            </ThemedText>
            <IconButton name="queue" label="Up Next" size={22} onPress={() => router.push('/queue')} />
          </View>

          <View
            style={styles.artworkArea}
            onLayout={(e) => {
              const { width, height } = e.nativeEvent.layout;
              setArtworkSize(Math.floor(Math.min(width, height, MAX_ARTWORK)));
            }}>
            {artworkSize > 0 && <Artwork uri={current.artworkUrl} size={artworkSize} />}
          </View>

          <View style={styles.titles}>
            <ThemedText type="smallBold" style={styles.title} numberOfLines={2} accessibilityRole="header">
              {current.title}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {current.podcastTitle}
            </ThemedText>
          </View>
        </View>

        <View style={styles.bottom}>
          <Scrubber />

          <View style={styles.controls}>
            <IconButton
              name={`skipBack${skipBackSec}`}
              label={`Skip back ${skipBackSec} seconds`}
              size={32}
              onPress={skipBack}
              style={styles.skip}
            />
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
            <IconButton
              name={`skipForward${skipForwardSec}`}
              label={`Skip forward ${skipForwardSec} seconds`}
              size={32}
              onPress={skipForward}
              style={styles.skip}
            />
          </View>

          <View style={styles.secondary}>
            <SpeedMenu />
            <SleepTimerMenu />
            <HighlightButton source="player" variant="pill" />
            <ShareButton episode={current} />
          </View>

          {error && (
            <ThemedText type="small" style={{ color: theme.danger, textAlign: 'center' }} accessibilityLiveRegion="polite">
              {error}
            </ThemedText>
          )}
        </View>
      </ThemedView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  top: { flex: 1, paddingHorizontal: Spacing.four, gap: Spacing.three },
  topBar: { flexDirection: 'row', alignItems: 'center', marginHorizontal: -Spacing.two },
  topTitle: { flex: 1, textAlign: 'center' },
  artworkArea: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 120 },
  titles: { alignItems: 'center', gap: Spacing.one, alignSelf: 'center', maxWidth: 480 },
  title: { fontSize: 20, lineHeight: 26, textAlign: 'center' },
  bottom: { paddingHorizontal: Spacing.four, paddingTop: Spacing.three, gap: Spacing.three, width: '100%', maxWidth: 560, alignSelf: 'center' },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.five },
  skip: { width: 64, height: 64 },
  playButton: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  secondary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
