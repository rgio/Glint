import type { Highlight } from '@podcast/shared';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '@/components/button';
import { HighlightCard } from '@/components/highlights';
import { EmptyState, useContentInsets } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { LOOKBACK_SEC } from '@/highlights/capture';
import { useHighlights } from '@/highlights/store';
import { highlightsMarkdown } from '@/highlights/text';
import { useTheme } from '@/hooks/use-theme';
import { saveTextFile } from '@/lib/save-file';

/** Every highlight across shows, newest first, searchable, with Markdown export. */
export default function HighlightsScreen() {
  const theme = useTheme();
  const insets = useContentInsets();
  const items = useHighlights((s) => s.items);
  const episodes = useHighlights((s) => s.episodes);
  const [query, setQuery] = useState('');
  const [withNote, setWithNote] = useState(false);

  const live = Object.values(items).filter((h) => !h.deleted);
  const needle = query.trim().toLowerCase();
  const shown = live
    .filter((h) => !withNote || h.note)
    .filter((h) => {
      if (!needle) return true;
      const e = episodes[h.episodeId];
      return [h.note, h.transcriptExcerpt, e?.title, e?.podcastTitle].some((t) => t?.toLowerCase().includes(needle));
    })
    .sort((a, b) => b.createdAt - a.createdAt);

  const exportAll = () =>
    saveTextFile(highlightsMarkdown(live, episodes, new Date()), `podcast-highlights-${new Date().toISOString().slice(0, 10)}.md`, {
      mimeType: 'text/markdown',
      uti: 'net.daringfireball.markdown',
      dialogTitle: 'Export highlights',
    });

  return (
    <ThemedView style={styles.fill}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.paddingBottom }]}>
        <View style={styles.column}>
          {live.length === 0 ? (
            <EmptyState
              title="No highlights yet"
              body={`While listening, tap Highlight in the player (or press H on the web) to save the last ${LOOKBACK_SEC} seconds. Add a note any time.`}
            />
          ) : (
            <>
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search notes, episodes and shows"
                placeholderTextColor={theme.textSecondary}
                accessibilityLabel="Search highlights"
                style={[styles.input, { color: theme.text, borderColor: theme.border }]}
              />
              <View style={styles.row}>
                <Pressable
                  role="checkbox"
                  aria-checked={withNote}
                  onPress={() => setWithNote((w) => !w)}
                  style={[styles.chip, { backgroundColor: withNote ? theme.tint : theme.backgroundElement }]}>
                  <ThemedText type="smallBold" style={{ color: withNote ? theme.background : theme.text }}>
                    Has a note
                  </ThemedText>
                </Pressable>
                <View style={styles.grow} />
                <Button title="Export as Markdown" variant="secondary" onPress={() => void exportAll()} />
              </View>
              {shown.length === 0 ? (
                <ThemedText type="small" themeColor="textSecondary">
                  No highlights match.
                </ThemedText>
              ) : (
                shown.map((h: Highlight) => <HighlightCard key={h.id} highlight={h} showEpisode />)
              )}
            </>
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
  input: { minHeight: 44, borderWidth: 1, borderRadius: Spacing.three, paddingHorizontal: Spacing.three, fontSize: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  grow: { flex: 1 },
  chip: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderRadius: Spacing.five },
});
