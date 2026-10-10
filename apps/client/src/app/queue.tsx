import { ScrollView, StyleSheet, View } from 'react-native';

import { Artwork } from '@/components/artwork';
import { IconButton } from '@/components/icon';
import { EmptyState, useContentInsets } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { usePlayer } from '@/player/store';

/** Up Next: the episodes lined up after the current one. Opened from Library and the player. */
export default function QueueScreen() {
  const theme = useTheme();
  const queue = usePlayer((s) => s.queue);
  const insets = useContentInsets();
  const { playEpisode, moveInQueue, removeFromQueue } = usePlayer.getState();

  return (
    <ThemedView style={styles.fill}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.paddingBottom }]}>
        <View style={styles.column}>
      {queue.length === 0 ? (
        <EmptyState
          title="Your queue is empty"
          body="Use Play next or Play last on any episode to line it up here."
        />
      ) : (
        queue.map((item, index) => (
          <View key={item.id} style={[styles.row, { borderBottomColor: theme.border }]}>
            <Artwork uri={item.artworkUrl} size={48} />
            <View style={styles.text}>
              <ThemedText type="smallBold" numberOfLines={2}>
                {item.title}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                {item.podcastTitle}
              </ThemedText>
            </View>
            <IconButton name="play" label={`Play ${item.title} now`} color={theme.tint} onPress={() => playEpisode(item)} />
            <IconButton
              name="up"
              label="Move up"
              disabled={index === 0}
              onPress={() => moveInQueue(item.id, -1)}
            />
            <IconButton
              name="down"
              label="Move down"
              disabled={index === queue.length - 1}
              onPress={() => moveInQueue(item.id, 1)}
            />
            <IconButton name="remove" label="Remove from queue" onPress={() => removeFromQueue(item.id)} />
          </View>
        ))
      )}
        </View>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { paddingHorizontal: Spacing.three, paddingTop: Spacing.three, alignItems: 'center' },
  column: { width: '100%', maxWidth: MaxContentWidth, gap: Spacing.two },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  text: { flex: 1 },
});
