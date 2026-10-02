import type { DirectoryPodcast, Podcast } from '@podcast/shared';
import { Link } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Artwork } from './artwork';
import { ThemedText } from './themed-text';

import { Spacing } from '@/constants/theme';

function RowBody({ podcast }: { podcast: Pick<Podcast, 'title' | 'author' | 'artworkUrl'> }) {
  return (
    <>
      <Artwork uri={podcast.artworkUrl} size={56} />
      <View style={styles.text}>
        <ThemedText type="smallBold" numberOfLines={2}>
          {podcast.title}
        </ThemedText>
        {podcast.author && (
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {podcast.author}
          </ThemedText>
        )}
      </View>
    </>
  );
}

export function PodcastRow({ podcast }: { podcast: Podcast }) {
  return (
    <Link href={{ pathname: '/podcast/[id]', params: { id: podcast.id } }} asChild>
      <Pressable style={({ pressed }) => [styles.row, pressed && styles.pressed]} accessibilityRole="link">
        <RowBody podcast={podcast} />
      </Pressable>
    </Link>
  );
}

/** A search or chart result. It isn't in the catalog yet, so opening it first resolves the feed. */
export function DirectoryRow({
  podcast,
  onPress,
  loading = false,
  disabled = false,
}: {
  podcast: DirectoryPodcast;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="link"
      aria-busy={loading}
      aria-disabled={disabled}
      style={({ pressed }) => [styles.row, (pressed || (disabled && !loading)) && styles.pressed]}>
      <RowBody podcast={podcast} />
      {loading && <ActivityIndicator accessibilityLabel="Opening" />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.two },
  text: { flex: 1 },
  pressed: { opacity: 0.6 },
});
