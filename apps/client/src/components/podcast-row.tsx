import type { Podcast } from '@podcast/shared';
import { Link } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Artwork } from './artwork';
import { ThemedText } from './themed-text';

import { Spacing } from '@/constants/theme';

export function PodcastRow({ podcast }: { podcast: Podcast }) {
  return (
    <Link href={{ pathname: '/podcast/[id]', params: { id: podcast.id } }} asChild>
      <Pressable style={({ pressed }) => [styles.row, pressed && styles.pressed]} accessibilityRole="link">
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
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.two },
  text: { flex: 1 },
  pressed: { opacity: 0.6 },
});
