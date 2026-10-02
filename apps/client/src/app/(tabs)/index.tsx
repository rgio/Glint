import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Artwork } from '@/components/artwork';
import { Button } from '@/components/button';
import { EpisodeRow } from '@/components/episode-row';
import { EmptyState, SectionTitle, TabScreen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { formatDuration } from '@/lib/format';
import { useNewEpisodes } from '@/library/new-episodes';
import { useLibrary } from '@/library/store';
import { usePlayer } from '@/player/store';

export default function HomeScreen() {
  // Remember when the listener left Home, so next time "New" only shows what arrived since.
  useFocusEffect(useCallback(() => () => useLibrary.getState().markHomeVisited(), []));

  // F-11: "New" replaces push notifications in v1.
  const { listed: fresh, loading, subscribed } = useNewEpisodes();

  return (
    <TabScreen title="Home">
      <ContinueListening />

      <SectionTitle>New</SectionTitle>
      {!subscribed ? (
        <EmptyState title="Nothing here yet" body="Subscribe to shows and their new episodes will show up here.">
          <Button title="Find a show" variant="secondary" onPress={() => router.navigate('/discover')} />
        </EmptyState>
      ) : fresh.length === 0 ? (
        <EmptyState
          title={loading ? 'Checking for new episodes…' : "You're all caught up"}
          body={loading ? '' : 'No new episodes since your last visit.'}
        />
      ) : (
        fresh.map(({ episode, podcast }) => (
          <EpisodeRow key={episode.id} episode={episode} podcast={podcast} showPodcast />
        ))
      )}
    </TabScreen>
  );
}

function ContinueListening() {
  const current = usePlayer((s) => s.current);
  const positionSec = usePlayer((s) => s.positionSec);
  const durationSec = usePlayer((s) => s.durationSec);
  if (!current) return null;

  const left = durationSec ? formatDuration(durationSec - positionSec) : null;
  return (
    <>
      <SectionTitle>Continue listening</SectionTitle>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Continue ${current.title}`}
        onPress={() => router.push('/player')}>
        <ThemedView type="backgroundElement" style={styles.card}>
          <Artwork uri={current.artworkUrl} size={64} />
          <View style={styles.cardText}>
            <ThemedText type="smallBold" numberOfLines={2}>
              {current.title}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {[current.podcastTitle, left && `${left} left`].filter(Boolean).join(' · ')}
            </ThemedText>
          </View>
        </ThemedView>
      </Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.three, borderRadius: Spacing.three },
  cardText: { flex: 1 },
});
