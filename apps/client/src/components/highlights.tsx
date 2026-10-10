import type { Highlight, HighlightSource } from '@podcast/shared';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { Icon, IconButton } from './icon';
import { ThemedText } from './themed-text';
import { ThemedView } from './themed-view';

import { Spacing, WebPlayerHeight } from '@/constants/theme';
import { openHighlightEditor } from '@/highlights/editor';
import { useHighlights } from '@/highlights/store';
import { quoteText, rangeLabel } from '@/highlights/text';
import { useTheme } from '@/hooks/use-theme';
import { shareText } from '@/lib/share';
import { episodeShareUrl } from '@/lib/share-link';
import { usePlayer } from '@/player/store';

const TOAST_MS = 5000;

/**
 * Opens the highlight editor for what's playing, set to the last 30 seconds heard. A labelled
 * pill in the full player, an icon in the player bar.
 */
export function HighlightButton({ source, variant }: { source: HighlightSource; variant: 'pill' | 'icon' }) {
  const theme = useTheme();
  const hasEpisode = usePlayer((s) => s.current !== null);
  const open = () => openHighlightEditor({ source });
  const label = 'New highlight or note';

  if (variant === 'icon') return <IconButton name="highlight" label={label} disabled={!hasEpisode} onPress={open} />;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={!hasEpisode}
      onPress={open}
      style={({ pressed }) => [styles.pill, { backgroundColor: theme.backgroundElement }, pressed && styles.pressed]}>
      <Icon name="highlight" size={18} />
      <ThemedText type="smallBold">Highlight</ThemedText>
    </Pressable>
  );
}

/**
 * The toast after a quick capture (the H key) or a deletion, with Undo, and Add note after a
 * capture. Rendered once, above everything.
 */
export function HighlightOverlay() {
  const theme = useTheme();
  const toast = useHighlights((s) => s.toast);
  const items = useHighlights((s) => s.items);
  const { undo, dismissToast } = useHighlights.getState();

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(dismissToast, TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast, dismissToast]);

  const toasted = toast && items[toast.id];
  return (
    <>
      {toast && toasted && (
        <View style={styles.toastWrap}>
          <ThemedView type="backgroundSelected" style={styles.toast} accessibilityLiveRegion="polite" role="status">
            <ThemedText type="smallBold" style={styles.toastText}>
              {toast.kind === 'captured'
                ? `Highlighted ${rangeLabel(toasted)}`
                : 'Highlight deleted'}
            </ThemedText>
            {toast.kind === 'captured' && (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  dismissToast();
                  openHighlightEditor({ id: toasted.id });
                }}>
                <ThemedText type="smallBold" style={{ color: theme.tint }}>
                  Add note
                </ThemedText>
              </Pressable>
            )}
            <Pressable accessibilityRole="button" onPress={undo}>
              <ThemedText type="smallBold" style={{ color: theme.tint }}>
                Undo
              </ThemedText>
            </Pressable>
          </ThemedView>
        </View>
      )}
    </>
  );
}

/** One highlight: its range, note, and what you can do with it. */
export function HighlightCard({ highlight, showEpisode = false }: { highlight: Highlight; showEpisode?: boolean }) {
  const theme = useTheme();
  const episode = useHighlights((s) => s.episodes[highlight.episodeId]);
  const { remove } = useHighlights.getState();
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), 2500);
    return () => clearTimeout(timer);
  }, [message]);

  const range = rangeLabel(highlight);
  const share = async () => {
    if (!episode) return;
    const text = quoteText(highlight, episode);
    const url = episodeShareUrl(highlight.episodeId);
    try {
      const outcome = await shareText({ title: episode.title, text, url, copy: `${text}\n${url}` });
      if (outcome === 'copied') setMessage('Quote copied');
    } catch {
      setMessage("Couldn't share");
    }
  };

  return (
    <ThemedView type="backgroundElement" style={styles.card} aria-label={`Highlight ${range}`}>
      {showEpisode && episode && (
        <Pressable
          accessibilityRole="link"
          onPress={() => router.push({ pathname: '/episode/[id]', params: { id: highlight.episodeId } })}>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {`${episode.podcastTitle} · ${episode.title}`}
          </ThemedText>
        </Pressable>
      )}
      <View style={styles.row}>
        <ThemedText type="smallBold" style={styles.grow}>
          {`${range} · ${Math.round(highlight.endSec - highlight.startSec)} s`}
        </ThemedText>
        <IconButton
          name="play"
          label={`Play highlight ${range}`}
          size={18}
          color={theme.tint}
          disabled={!episode}
          onPress={() => episode && usePlayer.getState().playRange(episode, highlight.startSec, highlight.endSec)}
        />
        <IconButton name="share" label={`Share quote ${range}`} size={18} disabled={!episode} onPress={share} />
        <IconButton name="trash" label={`Delete highlight ${range}`} size={18} onPress={() => remove(highlight.id)} />
      </View>
      {message && (
        <ThemedText type="small" themeColor="textSecondary" accessibilityLiveRegion="polite">
          {message}
        </ThemedText>
      )}
      <Pressable accessibilityRole="button" accessibilityLabel={highlight.note ? `Edit note: ${highlight.note}` : `Add note to ${range}`} onPress={() => openHighlightEditor({ id: highlight.id })}>
        {highlight.note ? (
          <ThemedText>{highlight.note}</ThemedText>
        ) : (
          <ThemedText type="small" style={{ color: theme.tint }}>
            Add note
          </ThemedText>
        )}
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`Edit highlight ${range}`} onPress={() => openHighlightEditor({ id: highlight.id })}>
        <ThemedText type="small" themeColor="textSecondary">
          Edit range and note
        </ThemedText>
      </Pressable>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, minHeight: 44, borderRadius: 22, paddingHorizontal: Spacing.three },
  pressed: { opacity: 0.6 },
  toastWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    // Above the web player bar, or the tab bar on phones.
    bottom: Platform.OS === 'web' ? WebPlayerHeight + Spacing.three : 120,
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    // Taps outside the toast itself reach the page underneath.
    pointerEvents: 'box-none',
  },
  toast: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.two, paddingHorizontal: Spacing.three, borderRadius: Spacing.three, maxWidth: 560 },
  toastText: { flexShrink: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  grow: { flex: 1 },
  card: { gap: Spacing.one, padding: Spacing.three, borderRadius: Spacing.three },
});
