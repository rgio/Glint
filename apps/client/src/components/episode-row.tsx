import type { Episode, Podcast } from '@podcast/shared';
import { StyleSheet, View } from 'react-native';

import { Icon, IconButton } from './icon';
import { ThemedText } from './themed-text';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatDate, formatDuration, htmlToText } from '@/lib/format';
import { usePlayer } from '@/player/store';
import type { PlayableEpisode } from '@/player/types';

export function toPlayable(episode: Episode, podcast: Podcast): PlayableEpisode {
  return {
    id: episode.id,
    podcastId: podcast.id,
    title: episode.title,
    podcastTitle: podcast.title,
    url: episode.enclosureUrl,
    artworkUrl: episode.artworkUrl ?? podcast.artworkUrl,
    durationSec: episode.durationSec,
  };
}

export function EpisodeRow({ episode, podcast, showPodcast = false }: { episode: Episode; podcast: Podcast; showPodcast?: boolean }) {
  const theme = useTheme();
  const saved = usePlayer((s) => s.saved[episode.id]);
  const isCurrent = usePlayer((s) => s.current?.id === episode.id);
  const playing = usePlayer((s) => s.playing && isCurrent);
  const { playEpisode, togglePlay, playNext, playLast } = usePlayer.getState();

  const playable = toPlayable(episode, podcast);
  const duration = episode.durationSec;
  const remaining = saved && !saved.played && saved.positionSec > 0 && duration ? duration - saved.positionSec : null;
  const meta = [
    formatDate(episode.publishedAt),
    remaining ? `${formatDuration(remaining)} left` : formatDuration(duration),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <View style={[styles.row, { borderBottomColor: theme.border }]}>
      <View style={styles.text}>
        {showPodcast && (
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {podcast.title}
          </ThemedText>
        )}
        <ThemedText type="smallBold" numberOfLines={2}>
          {episode.title}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
          {htmlToText(episode.showNotesHtml)}
        </ThemedText>
        <View style={styles.meta}>
          {saved?.played && <Icon name="check" size={14} color={theme.textSecondary} />}
          <ThemedText type="small" themeColor="textSecondary">
            {saved?.played ? `Played · ${meta}` : meta}
          </ThemedText>
        </View>
      </View>
      <View style={styles.actions}>
        <IconButton
          name={playing ? 'pause' : 'play'}
          label={playing ? `Pause ${episode.title}` : `Play ${episode.title}`}
          color={theme.tint}
          onPress={() => (isCurrent ? togglePlay() : playEpisode(playable))}
        />
        <IconButton name="playNext" label="Play next" size={18} onPress={() => playNext(playable)} />
        <IconButton name="playLast" label="Play last" size={18} onPress={() => playLast(playable)} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: Spacing.two,
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  text: { flex: 1, gap: Spacing.half },
  meta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, marginTop: Spacing.one },
  actions: { alignItems: 'center' },
});
