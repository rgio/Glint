import { useQuery } from '@tanstack/react-query';
import { Link, Stack, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';

import { api, ApiError } from '@/api/client';
import { Artwork } from '@/components/artwork';
import { Button } from '@/components/button';
import { toPlayable } from '@/components/episode-row';
import { IconButton } from '@/components/icon';
import { SectionTitle, useContentInsets } from '@/components/screen';
import { ShowNotes } from '@/components/show-notes';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatDate, formatDuration } from '@/lib/format';
import { usePlayer } from '@/player/store';

/** F-05: one episode, with its show notes. Timestamps in the notes play from that point. */
export default function EpisodeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const insets = useContentInsets();
  const query = useQuery({
    queryKey: ['episode', id],
    queryFn: () => api.getEpisode(id),
    // A missing episode won't appear on a retry.
    retry: (count, err) => !(err instanceof ApiError && err.status === 404) && count < 2,
  });

  const saved = usePlayer((s) => s.saved[id]);
  const isCurrent = usePlayer((s) => s.current?.id === id);
  const playing = usePlayer((s) => s.playing && s.current?.id === id);
  const { playEpisode, togglePlay, playNext, playLast, setPlayed, playFrom } = usePlayer.getState();

  if (!query.data) {
    return (
      <ThemedView style={styles.center}>
        {query.error ? (
          <ThemedText style={{ color: theme.danger }}>
            {query.error instanceof ApiError && query.error.status === 404
              ? "This episode isn't available. It may have been removed from the show's feed."
              : query.error.message}
          </ThemedText>
        ) : (
          <ActivityIndicator />
        )}
      </ThemedView>
    );
  }

  const { episode, podcast } = query.data;
  const playable = toPlayable(episode, podcast);
  const inProgress = saved && !saved.played && saved.positionSec > 0;
  const left = inProgress && episode.durationSec ? formatDuration(episode.durationSec - saved.positionSec) : null;
  const meta = [
    saved?.played && 'Played',
    formatDate(episode.publishedAt),
    left ? `${left} left` : formatDuration(episode.durationSec),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <ThemedView style={styles.fill}>
      <Stack.Screen options={{ title: podcast.title }} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.paddingBottom }]}>
        <View style={styles.column}>
          <View style={styles.header}>
            <Artwork uri={playable.artworkUrl} size={120} />
            <View style={styles.headerText}>
              <ThemedText type="smallBold" style={styles.title} accessibilityRole="header">
                {episode.title}
              </ThemedText>
              <Link href={{ pathname: '/podcast/[id]', params: { id: podcast.id } }}>
                <ThemedText type="small" style={{ color: theme.tint }}>
                  {podcast.title}
                </ThemedText>
              </Link>
              <ThemedText type="small" themeColor="textSecondary">
                {meta}
              </ThemedText>
            </View>
          </View>

          <View style={styles.actions}>
            <Button
              title={playing ? 'Pause' : inProgress ? 'Resume' : 'Play'}
              onPress={() => (isCurrent ? togglePlay() : playEpisode(playable))}
              style={styles.play}
            />
            <IconButton name="playNext" label="Play next" onPress={() => playNext(playable)} />
            <IconButton name="playLast" label="Play last" onPress={() => playLast(playable)} />
            <IconButton
              name={saved?.played ? 'check' : 'checkOutline'}
              label={saved?.played ? 'Mark unplayed' : 'Mark played'}
              color={saved?.played ? theme.tint : undefined}
              onPress={() => setPlayed(episode.id, !saved?.played)}
            />
          </View>

          <SectionTitle>Show notes</SectionTitle>
          <ShowNotes
            html={episode.showNotesHtml}
            durationSec={episode.durationSec}
            onSeek={(seconds) => playFrom(playable, seconds)}
          />
        </View>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
  content: { paddingHorizontal: Spacing.three, paddingTop: Spacing.three, alignItems: 'center' },
  column: { width: '100%', maxWidth: MaxContentWidth, gap: Spacing.three },
  header: { flexDirection: 'row', gap: Spacing.three, alignItems: 'center' },
  headerText: { flex: 1, gap: Spacing.one },
  title: { fontSize: 20, lineHeight: 26 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  play: { flex: 1, maxWidth: 240 },
});
