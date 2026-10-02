import type { Podcast } from '@podcast/shared';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';

import { api } from '@/api/client';
import { Artwork } from '@/components/artwork';
import { Button } from '@/components/button';
import { EpisodeRow, toPlayable } from '@/components/episode-row';
import { useContentInsets } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { htmlToText } from '@/lib/format';
import { useLibrary } from '@/library/store';
import { usePlayer } from '@/player/store';

export default function PodcastScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const insets = useContentInsets();

  const podcastQuery = useQuery({ queryKey: ['podcast', id], queryFn: () => api.getPodcast(id) });
  const episodesQuery = useInfiniteQuery({
    queryKey: ['episodes', id],
    queryFn: ({ pageParam }) => api.listEpisodes(id, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });

  const podcast = podcastQuery.data?.podcast;
  const episodes = episodesQuery.data?.pages.flatMap((p) => p.episodes) ?? [];
  const error = podcastQuery.error ?? episodesQuery.error;

  if (!podcast) {
    return (
      <ThemedView style={styles.center}>
        {error ? (
          <ThemedText style={{ color: theme.danger }}>{error.message}</ThemedText>
        ) : (
          <ActivityIndicator />
        )}
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.fill}>
      <Stack.Screen options={{ title: podcast.title }} />
      <FlatList
        data={episodes}
        keyExtractor={(e) => e.id}
        renderItem={({ item }) => <EpisodeRow episode={item} podcast={podcast} />}
        ListHeaderComponent={<Header podcast={podcast} latest={episodes[0] ? toPlayable(episodes[0], podcast) : null} />}
        onEndReached={() => episodesQuery.hasNextPage && !episodesQuery.isFetchingNextPage && episodesQuery.fetchNextPage()}
        onEndReachedThreshold={0.5}
        ListFooterComponent={episodesQuery.isFetching ? <ActivityIndicator style={styles.footer} /> : null}
        contentContainerStyle={[styles.list, { paddingBottom: insets.paddingBottom }]}
        style={styles.fill}
      />
    </ThemedView>
  );
}

function Header({ podcast, latest }: { podcast: Podcast; latest: ReturnType<typeof toPlayable> | null }) {
  const subscribed = useLibrary((s) => podcast.id in s.subscriptions);
  const toggleSubscription = useLibrary((s) => s.toggleSubscription);
  const playEpisode = usePlayer((s) => s.playEpisode);

  return (
    <View style={styles.header}>
      <View style={styles.headerTop}>
        <Artwork uri={podcast.artworkUrl} size={120} />
        <View style={styles.headerText}>
          <ThemedText type="smallBold" style={styles.title} accessibilityRole="header">
            {podcast.title}
          </ThemedText>
          {podcast.author && (
            <ThemedText type="small" themeColor="textSecondary">
              {podcast.author}
            </ThemedText>
          )}
        </View>
      </View>
      <View style={styles.headerActions}>
        <Button
          title={subscribed ? 'Subscribed' : 'Subscribe'}
          variant={subscribed ? 'secondary' : 'primary'}
          aria-selected={subscribed}
          onPress={() => toggleSubscription(podcast)}
          style={styles.grow}
        />
        {latest && (
          <Button title="Play latest" variant="secondary" onPress={() => playEpisode(latest)} style={styles.grow} />
        )}
      </View>
      {podcast.description && (
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={4}>
          {htmlToText(podcast.description)}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
  list: { paddingHorizontal: Spacing.three, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  header: { gap: Spacing.three, paddingVertical: Spacing.three },
  headerTop: { flexDirection: 'row', gap: Spacing.three, alignItems: 'center' },
  headerText: { flex: 1, gap: Spacing.one },
  title: { fontSize: 20, lineHeight: 26 },
  headerActions: { flexDirection: 'row', gap: Spacing.two },
  grow: { flex: 1 },
  footer: { padding: Spacing.three },
});
