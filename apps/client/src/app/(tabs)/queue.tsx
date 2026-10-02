import { StyleSheet, View } from 'react-native';

import { Artwork } from '@/components/artwork';
import { IconButton } from '@/components/icon';
import { EmptyState, TabScreen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { usePlayer } from '@/player/store';

export default function QueueScreen() {
  const theme = useTheme();
  const queue = usePlayer((s) => s.queue);
  const { playEpisode, moveInQueue, removeFromQueue } = usePlayer.getState();

  return (
    <TabScreen title="Up Next">
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
    </TabScreen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  text: { flex: 1 },
});
