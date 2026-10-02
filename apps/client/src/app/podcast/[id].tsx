import type { Episode, Podcast } from '@podcast/shared';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';

import { api, type EpisodeSort } from '@/api/client';
import { Artwork } from '@/components/artwork';
import { Button } from '@/components/button';
import { EpisodeRow, toPlayable } from '@/components/episode-row';
import { SectionTitle, useContentInsets } from '@/components/screen';
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

  const [sort, setSort] = useState<EpisodeSort>('newest');

  const podcastQuery = useQuery({ queryKey: ['podcast', id], queryFn: () => api.getPodcast(id) });
  const episodesQuery = useInfiniteQuery({
    queryKey: ['episodes', id, 'list', sort],
    queryFn: ({ pageParam }) => api.listEpisodes(id, pageParam, 50, sort),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  // "Play latest" must not depend on the list's sort order. Same query as Home's "New" section.
  const latestQuery = useQuery({
    queryKey: ['episodes', id, 'latest'],
    queryFn: () => api.listEpisodes(id, null, 10),
  });

  const podcast = podcastQuery.data?.podcast;
  const episodes = episodesQuery.data?.pages.flatMap((p) => p.episodes) ?? [];
  const latest = latestQuery.data?.episodes[0];
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
        data={withSeasonHeadings(episodes)}
        keyExtractor={(row) => row.key}
        renderItem={({ item }) =>
          item.type === 'season' ? (
            <SectionTitle>{item.season === null ? 'Other episodes' : `Season ${item.season}`}</SectionTitle>
          ) : (
            <EpisodeRow episode={item.episode} podcast={podcast} />
          )
        }
        ListHeaderComponent={
          <>
            <Header podcast={podcast} latest={latest ? toPlayable(latest, podcast) : null} />
            <SortControl sort={sort} onChange={setSort} />
          </>
        }
        onEndReached={() => episodesQuery.hasNextPage && !episodesQuery.isFetchingNextPage && episodesQuery.fetchNextPage()}
        onEndReachedThreshold={0.5}
        ListFooterComponent={episodesQuery.isFetching ? <ActivityIndicator style={styles.footer} /> : null}
        contentContainerStyle={[styles.list, { paddingBottom: insets.paddingBottom }]}
        style={styles.fill}
      />
    </ThemedView>
  );
}

type ListRow = { type: 'season'; season: number | null; key: string } | { type: 'episode'; episode: Episode; key: string };

/**
 * F-04: inserts a "Season N" heading wherever the season changes. Only for shows that use
 * seasons (two or more among the loaded episodes), so single-season shows stay a plain list.
 */
function withSeasonHeadings(episodes: Episode[]): ListRow[] {
  const seasons = new Set(episodes.map((e) => e.season).filter((s) => s !== null));
  if (seasons.size < 2) return episodes.map((episode) => ({ type: 'episode', episode, key: episode.id }));
  const rows: ListRow[] = [];
  let previous: number | null | undefined;
  for (const episode of episodes) {
    if (episode.season !== previous) {
      rows.push({ type: 'season', season: episode.season, key: `season-${episode.season}-${rows.length}` });
      previous = episode.season;
    }
    rows.push({ type: 'episode', episode, key: episode.id });
  }
  return rows;
}

const SORTS: { value: EpisodeSort; label: string }[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
];

function SortControl({ sort, onChange }: { sort: EpisodeSort; onChange: (sort: EpisodeSort) => void }) {
  const theme = useTheme();
  return (
    <View
      role="radiogroup"
      aria-label="Sort episodes"
      style={[styles.sort, { backgroundColor: theme.backgroundElement }]}>
      {SORTS.map(({ value, label }) => {
        const active = value === sort;
        return (
          <Pressable
            key={value}
            role="radio"
            aria-checked={active}
            onPress={() => onChange(value)}
            style={[styles.sortOption, active && { backgroundColor: theme.backgroundSelected }]}>
            <ThemedText type="small" themeColor={active ? 'text' : 'textSecondary'}>
              {label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
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
  sort: { flexDirection: 'row', alignSelf: 'flex-start', borderRadius: Spacing.three, padding: Spacing.half },
  sortOption: { minHeight: 32, justifyContent: 'center', paddingHorizontal: Spacing.three, borderRadius: Spacing.three },
});
