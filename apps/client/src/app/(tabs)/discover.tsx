import type { Category, DirectoryPodcast } from '@podcast/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
  type TextStyle,
} from 'react-native';

import { api, isDirectoryNotConfigured } from '@/api/client';
import { Button } from '@/components/button';
import { DirectoryRow } from '@/components/podcast-row';
import { EmptyState, SectionTitle, TabScreen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useTheme } from '@/hooks/use-theme';
import { deviceLanguage } from '@/lib/locale';

// Shown when search and charts aren't set up on the server.
const STARTER_FEEDS = [
  { title: 'Podnews Daily', feedUrl: 'https://podnews.net/rss' },
  { title: 'The Vergecast', feedUrl: 'https://feeds.megaphone.fm/vergecast' },
];

// Podcast Index has over 100 categories, many of them narrow; offer the broad ones that exist.
const FEATURED_CATEGORIES = [
  'News',
  'Comedy',
  'Society',
  'Business',
  'Technology',
  'Science',
  'History',
  'True Crime',
  'Sports',
  'Health',
  'Education',
  'Arts',
  'Fiction',
  'Music',
  'Kids',
];

const MIN_QUERY_LENGTH = 2;
// Wide web windows wrap the category chips, since a mouse can't easily scroll them sideways.
const WRAP_CHIPS_MIN_WIDTH = 720;

// The search box's border shows focus, so hide the browser's focus ring around the inner input.
// React Native's types only list visible outline styles, but React Native Web accepts 'none'.
const NO_FOCUS_RING = Platform.select<TextStyle>({
  web: { outlineStyle: 'none' as unknown as TextStyle['outlineStyle'] },
  default: {},
});
const retryUnlessNotConfigured = (count: number, err: Error) => !isDirectoryNotConfigured(err) && count < 2;

export default function DiscoverScreen() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [section, setSection] = useState('top');
  const [feedUrl, setFeedUrl] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const searchTerm = useDebouncedValue(query.trim(), 300);
  const searching = query.trim().length >= MIN_QUERY_LENGTH;

  const resolve = useMutation({
    mutationFn: api.resolvePodcast,
    onSuccess: ({ podcast }) => {
      queryClient.setQueryData(['podcast', podcast.id], { podcast });
      setFeedUrl('');
      router.push({ pathname: '/podcast/[id]', params: { id: podcast.id } });
    },
  });

  const search = useQuery({
    queryKey: ['search', searchTerm],
    queryFn: () => api.search(searchTerm),
    enabled: searchTerm.length >= MIN_QUERY_LENGTH,
    retry: retryUnlessNotConfigured,
    staleTime: 10 * 60_000,
  });

  // Charts mix every language unless filtered; search has no language filter upstream.
  const [language] = useState(deviceLanguage);
  const charts = useQuery({
    queryKey: ['discover', section, language],
    queryFn: () => api.discover(section, language),
    retry: retryUnlessNotConfigured,
    staleTime: 60 * 60_000,
  });

  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: api.categories,
    retry: retryUnlessNotConfigured,
    staleTime: 24 * 60 * 60_000,
  });

  const directoryOff = isDirectoryNotConfigured(charts.error) || isDirectoryNotConfigured(search.error);
  // Search results stay on screen while the next query loads.
  const searchPending = searching && (searchTerm !== query.trim() || search.isFetching);

  const open = (podcast: DirectoryPodcast) => resolve.mutate(podcast.feedUrl);
  const rows = (results: DirectoryPodcast[]) =>
    results.map((podcast) => (
      <DirectoryRow
        key={podcast.feedUrl}
        podcast={podcast}
        onPress={() => open(podcast)}
        loading={resolve.isPending && resolve.variables === podcast.feedUrl}
        disabled={resolve.isPending}
      />
    ));

  return (
    <TabScreen title="Discover">
      {!directoryOff && (
        <View style={[styles.searchBox, { borderColor: searchFocused ? theme.tint : theme.border }]}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            placeholder="Search podcasts"
            placeholderTextColor={theme.textSecondary}
            accessibilityLabel="Search podcasts"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            clearButtonMode="while-editing"
            style={[styles.searchInput, NO_FOCUS_RING, { color: theme.text }]}
          />
          {searchPending && <ActivityIndicator accessibilityLabel="Searching" />}
        </View>
      )}

      {resolve.error && (
        <ThemedText type="small" style={{ color: theme.danger }} accessibilityLiveRegion="polite">
          {resolve.error.message}
        </ThemedText>
      )}

      {searching && !directoryOff ? (
        <SearchResults
          term={searchTerm}
          results={search.data?.results}
          error={search.error}
          pending={searchPending}
          renderRows={rows}
        />
      ) : (
        <>
          {!directoryOff && (
            <>
              <CategoryChips categories={categories.data?.categories ?? []} selected={section} onSelect={setSection} />
              <SectionTitle>{sectionTitle(section, categories.data?.categories)}</SectionTitle>
              {charts.isPending ? (
                <ActivityIndicator style={styles.loading} accessibilityLabel="Loading charts" />
              ) : charts.isError ? (
                <ThemedText type="small" style={{ color: theme.danger }}>
                  {charts.error.message}
                </ThemedText>
              ) : (
                rows(charts.data.results)
              )}
            </>
          )}

          {directoryOff && (
            <>
              <EmptyState
                title="Search isn't set up yet"
                body="This server has no Podcast Index key, so search and charts are off. You can still add a show by its RSS URL."
              />
              <SectionTitle>Try these</SectionTitle>
              {STARTER_FEEDS.map((feed) => (
                <Button
                  key={feed.feedUrl}
                  title={feed.title}
                  variant="secondary"
                  disabled={resolve.isPending}
                  onPress={() => resolve.mutate(feed.feedUrl)}
                />
              ))}
            </>
          )}

          <SectionTitle>Add by RSS URL</SectionTitle>
          <View style={styles.form}>
            <TextInput
              value={feedUrl}
              onChangeText={setFeedUrl}
              onSubmitEditing={() => feedUrl && resolve.mutate(feedUrl)}
              placeholder="https://example.com/feed.xml"
              placeholderTextColor={theme.textSecondary}
              accessibilityLabel="Podcast RSS feed URL"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="go"
              style={[styles.input, { color: theme.text, borderColor: theme.border }]}
            />
            <Button
              title="Add"
              loading={resolve.isPending && resolve.variables === feedUrl}
              disabled={!feedUrl.trim() || resolve.isPending}
              onPress={() => resolve.mutate(feedUrl)}
            />
          </View>
        </>
      )}
    </TabScreen>
  );
}

function sectionTitle(section: string, categories: Category[] | undefined) {
  if (section === 'top') return 'Trending';
  const id = Number(section.slice('category:'.length));
  const name = categories?.find((c) => c.id === id)?.name;
  return name ? `Trending in ${name}` : 'Trending';
}

function SearchResults({
  term,
  results,
  error,
  pending,
  renderRows,
}: {
  term: string;
  results: DirectoryPodcast[] | undefined;
  error: Error | null;
  pending: boolean;
  renderRows: (results: DirectoryPodcast[]) => React.ReactNode;
}) {
  const theme = useTheme();
  if (error && !pending) {
    return (
      <ThemedText type="small" style={{ color: theme.danger }}>
        {error.message}
      </ThemedText>
    );
  }
  if (!results) return null;
  if (results.length === 0 && !pending) {
    return <EmptyState title="No shows found" body={`Nothing matched “${term}”. Try a show title or host name.`} />;
  }
  return (
    <>
      <SectionTitle>Shows</SectionTitle>
      {renderRows(results)}
    </>
  );
}

function CategoryChips({
  categories,
  selected,
  onSelect,
}: {
  categories: Category[];
  selected: string;
  onSelect: (section: string) => void;
}) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const wrap = Platform.OS === 'web' && width >= WRAP_CHIPS_MIN_WIDTH;
  const byName = new Map(categories.map((c) => [c.name.toLowerCase(), c]));
  const featured = FEATURED_CATEGORIES.map((name) => byName.get(name.toLowerCase())).filter(
    (c): c is Category => c !== undefined,
  );
  const chips = [
    { section: 'top', label: 'Top' },
    ...featured.map((c) => ({ section: `category:${c.id}`, label: c.name })),
  ];

  const content = chips.map((chip) => {
    const active = chip.section === selected;
    return (
      <Pressable
        key={chip.section}
        onPress={() => onSelect(chip.section)}
        role="tab"
        aria-selected={active}
        style={({ pressed }) => [
          styles.chip,
          { backgroundColor: active ? theme.tint : theme.backgroundElement },
          pressed && styles.pressed,
        ]}>
        <ThemedText type="smallBold" style={{ color: active ? theme.background : theme.text }}>
          {chip.label}
        </ThemedText>
      </Pressable>
    );
  });

  return wrap ? (
    <View role="tablist" aria-label="Charts" style={[styles.chips, styles.wrappedChips]}>
      {content}
    </View>
  ) : (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      role="tablist"
      aria-label="Charts"
      contentContainerStyle={styles.chips}>
      {content}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    marginTop: Spacing.two,
  },
  searchInput: { flex: 1, minHeight: 42, fontSize: 16 },
  chips: { gap: Spacing.two, paddingVertical: Spacing.two },
  wrappedChips: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderRadius: Spacing.five },
  pressed: { opacity: 0.6 },
  loading: { marginVertical: Spacing.four },
  form: { flexDirection: 'row', gap: Spacing.two },
  input: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
  },
});
