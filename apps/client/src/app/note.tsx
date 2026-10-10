import { HIGHLIGHT_MAX_SEC, HIGHLIGHT_MIN_SEC, HIGHLIGHT_NOTE_MAX, HighlightSource } from '@podcast/shared';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '@/components/button';
import { RangeSelector } from '@/components/range-selector';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { captureRange } from '@/highlights/capture';
import { useHighlights } from '@/highlights/store';
import { rangeLabel } from '@/highlights/text';
import { useTheme } from '@/hooks/use-theme';
import { usePlayer } from '@/player/store';

/** How much of the episode the range track shows either side of the highlight. */
const WINDOW_MARGIN_SEC = 60;

type Range = { startSec: number; endSec: number };

const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

/** Moves one edge of `range`, keeping it within the episode and between the shortest and longest highlight. */
function moveEdge(range: Range, edge: 'start' | 'end', seconds: number, durationSec: number | null): Range {
  const limit = durationSec ?? Infinity;
  if (edge === 'start') {
    const lowest = Math.max(0, range.endSec - HIGHLIGHT_MAX_SEC);
    return { ...range, startSec: Math.round(Math.min(range.endSec - HIGHLIGHT_MIN_SEC, Math.max(lowest, seconds))) };
  }
  const highest = Math.min(limit, range.startSec + HIGHLIGHT_MAX_SEC);
  return { ...range, endSec: Math.round(Math.max(range.startSec + HIGHLIGHT_MIN_SEC, Math.min(highest, seconds))) };
}

/** The stretch of the episode to show around `range`. */
function windowAround(range: Range, durationSec: number | null): Range {
  return {
    startSec: Math.max(0, range.startSec - WINDOW_MARGIN_SEC),
    endSec: Math.min(durationSec ?? Infinity, range.endSec + WINDOW_MARGIN_SEC),
  };
}

/**
 * The highlight editor: pick the range with the handles (or 5-second nudges), play it back, and
 * write a note. Opened from the highlight buttons for a new highlight of what's playing, which
 * defaults to the last 30 seconds heard, or with `id` to edit a saved one. Playback carries on.
 */
export default function NoteScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ id?: string; source?: string }>();
  const existing = useHighlights((s) => (params.id ? s.items[params.id] : undefined));
  const savedEpisode = useHighlights((s) => (existing ? s.episodes[existing.episodeId] : undefined));
  const current = usePlayer((s) => s.current);
  const positionSec = usePlayer((s) => s.positionSec);

  const episode = existing ? savedEpisode : current;
  const durationSec = existing ? existing.anchorDurationSec : (usePlayer.getState().durationSec ?? current?.durationSec ?? null);

  const [range, setRange] = useState<Range>(() => {
    if (existing) return { startSec: existing.startSec, endSec: existing.endSec };
    const { positionSec, rate } = usePlayer.getState();
    const r = captureRange({ episodeId: current?.id ?? '', positionSec, rate, durationSec, now: Date.now(), last: null });
    return { startSec: Math.round(r.startSec), endSec: Math.round(r.endSec) };
  });
  // The track's window only changes between drags, so it doesn't shift under a finger.
  const [window, setWindow] = useState<Range>(() => windowAround(range, durationSec));
  const [note, setNote] = useState(existing?.note ?? '');
  const [dragging, setDragging] = useState(false);

  const change = (edge: 'start' | 'end', seconds: number) => setRange((r) => moveEdge(r, edge, seconds, durationSec));
  const nudge = (edge: 'start' | 'end', by: number) => {
    const next = moveEdge(range, edge, (edge === 'start' ? range.startSec : range.endSec) + by, durationSec);
    setRange(next);
    if (next.startSec < window.startSec || next.endSec > window.endSec) setWindow(windowAround(next, durationSec));
  };

  const save = () => {
    const store = useHighlights.getState();
    if (existing) {
      store.setRange(existing.id, range.startSec, range.endSec);
      store.setNote(existing.id, note);
    } else {
      const source = HighlightSource.safeParse(params.source);
      store.add(source.success ? source.data : 'player', range, note);
    }
    close();
  };

  const preview = () => episode && usePlayer.getState().playRange(episode, range.startSec, range.endSec);
  const missing = !episode || (params.id && !existing);

  return (
    <ThemedView style={styles.fill}>
      <Stack.Screen
        options={{
          title: existing ? 'Edit highlight' : 'New highlight',
          headerLeft: () => (
            <Pressable accessibilityRole="button" onPress={close} hitSlop={8}>
              <ThemedText style={{ color: theme.tint }}>Cancel</ThemedText>
            </Pressable>
          ),
          headerRight: () =>
            missing ? null : (
              <Pressable accessibilityRole="button" accessibilityLabel="Save highlight" onPress={save} hitSlop={8}>
                <ThemedText type="smallBold" style={{ color: theme.tint }}>
                  Save
                </ThemedText>
              </Pressable>
            ),
        }}
      />
      {missing ? (
        <View style={styles.content}>
          <ThemedText type="small" themeColor="textSecondary">
            {params.id ? 'This highlight no longer exists.' : 'Play an episode to highlight part of it.'}
          </ThemedText>
        </View>
      ) : (
        <ScrollView
          scrollEnabled={!dragging}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={styles.content}>
          <View style={styles.column}>
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
              {`${episode.podcastTitle} · ${episode.title}`}
            </ThemedText>
            <ThemedText type="subtitle" accessibilityLiveRegion="polite">
              {`${rangeLabel(range)} · ${range.endSec - range.startSec} s`}
            </ThemedText>

            <RangeSelector
              windowStartSec={window.startSec}
              windowEndSec={window.endSec}
              startSec={range.startSec}
              endSec={range.endSec}
              positionSec={current?.id === episode.id ? positionSec : undefined}
              onChange={change}
              onDragging={(d) => {
                setDragging(d);
                if (!d) setWindow((w) => (range.startSec <= w.startSec || range.endSec >= w.endSec ? windowAround(range, durationSec) : w));
              }}
            />

            {(['start', 'end'] as const).map((edge) => (
              <View key={edge} style={styles.row}>
                <ThemedText type="small" style={styles.edge}>
                  {edge === 'start' ? 'Start' : 'End'}
                </ThemedText>
                <Button title="−5 s" variant="secondary" accessibilityLabel={`Move ${edge} 5 seconds earlier`} onPress={() => nudge(edge, -5)} style={styles.grow} />
                <Button title="+5 s" variant="secondary" accessibilityLabel={`Move ${edge} 5 seconds later`} onPress={() => nudge(edge, 5)} style={styles.grow} />
              </View>
            ))}

            <Button title="Play this part" variant="secondary" onPress={preview} />

            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="Add a note (optional)"
              placeholderTextColor={theme.textSecondary}
              accessibilityLabel="Note"
              multiline
              maxLength={HIGHLIGHT_NOTE_MAX}
              style={[styles.noteInput, { color: theme.text, borderColor: theme.border }]}
            />
            <Button title="Save" onPress={save} />
          </View>
        </ScrollView>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: Spacing.three, alignItems: 'center' },
  column: { width: '100%', maxWidth: MaxContentWidth, gap: Spacing.three },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  edge: { width: 40 },
  grow: { flex: 1 },
  noteInput: { minHeight: 140, borderWidth: 1, borderRadius: Spacing.two, padding: Spacing.two, fontSize: 16, textAlignVertical: 'top' },
});
