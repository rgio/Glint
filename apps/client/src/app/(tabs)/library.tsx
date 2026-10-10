import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { PodcastRow } from '@/components/podcast-row';
import { EmptyState, SectionTitle, TabScreen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { exportSubscriptions, importOpml, type OpmlImportOutcome } from '@/library/opml';
import { useLibrary } from '@/library/store';
import { usePlayer } from '@/player/store';

type ImportState =
  | { kind: 'idle' }
  | { kind: 'running'; done: number; total: number }
  | { kind: 'done'; outcome: OpmlImportOutcome }
  | { kind: 'error'; message: string };

export default function LibraryScreen() {
  const theme = useTheme();
  const subscriptions = useLibrary((s) => s.subscriptions);
  const podcasts = Object.values(subscriptions)
    .map((s) => s.podcast)
    .sort((a, b) => a.title.localeCompare(b.title));
  const [importState, setImportState] = useState<ImportState>({ kind: 'idle' });
  const [exportError, setExportError] = useState<string | null>(null);
  const importing = importState.kind === 'running';

  const startImport = async () => {
    try {
      const outcome = await importOpml((done, total) => setImportState({ kind: 'running', done, total }));
      setImportState(outcome ? { kind: 'done', outcome } : { kind: 'idle' });
    } catch (err) {
      setImportState({ kind: 'error', message: (err as Error).message });
    }
  };

  const startExport = async () => {
    setExportError(null);
    try {
      await exportSubscriptions();
    } catch (err) {
      setExportError((err as Error).message);
    }
  };

  return (
    <TabScreen title="Library">
      <UpNextRow />
      <SectionTitle>Subscriptions</SectionTitle>
      <View style={styles.actions}>
        <Button title="Import OPML" variant="secondary" loading={importing} onPress={startImport} style={styles.grow} />
        <Button
          title="Export OPML"
          variant="secondary"
          disabled={podcasts.length === 0 || importing}
          onPress={startExport}
          style={styles.grow}
        />
      </View>
      {exportError && (
        <ThemedText type="small" style={{ color: theme.danger }} accessibilityLiveRegion="polite">
          {exportError}
        </ThemedText>
      )}
      <ImportStatus state={importState} onDismiss={() => setImportState({ kind: 'idle' })} />

      {podcasts.length === 0 ? (
        <EmptyState
          title="No subscriptions yet"
          body="Shows you subscribe to appear here. Moving from another app? Export an OPML file there and import it here.">
          <Button title="Find a show" variant="secondary" onPress={() => router.navigate('/discover')} />
        </EmptyState>
      ) : (
        podcasts.map((podcast) => <PodcastRow key={podcast.id} podcast={podcast} />)
      )}
    </TabScreen>
  );
}

/** Leads to the queue (Up Next), with how many episodes are in it. */
function UpNextRow() {
  const count = usePlayer((s) => s.queue.length);
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`Up Next, ${count}`}
      onPress={() => router.push('/queue')}
      style={({ pressed }) => [pressed && styles.pressed]}>
      <ThemedView type="backgroundElement" style={styles.row}>
        <ThemedText type="smallBold">Up Next</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {count === 0 ? 'Empty' : `${count} ${count === 1 ? 'episode' : 'episodes'}`}
        </ThemedText>
      </ThemedView>
    </Pressable>
  );
}

function ImportStatus({ state, onDismiss }: { state: ImportState; onDismiss: () => void }) {
  const theme = useTheme();
  if (state.kind === 'idle') return null;

  if (state.kind === 'running') {
    return (
      <ThemedText type="small" themeColor="textSecondary" accessibilityLiveRegion="polite">
        {state.total === 0 ? 'Reading the file…' : `Adding shows: ${state.done} of ${state.total}`}
      </ThemedText>
    );
  }

  if (state.kind === 'error') {
    return (
      <ThemedView type="backgroundElement" style={styles.card}>
        <ThemedText type="smallBold">{"Couldn't import that file"}</ThemedText>
        <ThemedText type="small" style={{ color: theme.danger }}>
          {state.message}
        </ThemedText>
        <Button title="OK" variant="secondary" onPress={onDismiss} />
      </ThemedView>
    );
  }

  const { outcome } = state;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const summary = [
    `${outcome.added.length} added`,
    outcome.alreadySubscribed > 0 && `${outcome.alreadySubscribed} already in your library`,
    outcome.failed.length > 0 && `${outcome.failed.length} couldn't be added`,
    outcome.skippedInvalid > 0 && plural(outcome.skippedInvalid, "entry wasn't a feed", "entries weren't feeds"),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <ThemedView type="backgroundElement" style={styles.card} accessibilityLiveRegion="polite">
      <ThemedText type="smallBold">
        {outcome.found === 0 ? 'No shows found in that file' : `Found ${plural(outcome.found, 'show', 'shows')} in the file`}
      </ThemedText>
      {outcome.found > 0 && (
        <ThemedText type="small" themeColor="textSecondary">
          {summary}
        </ThemedText>
      )}
      {outcome.failed.map((f) => (
        <ThemedText key={f.feedUrl} type="small" themeColor="textSecondary" numberOfLines={2}>
          {`${f.name}: ${f.reason}`}
        </ThemedText>
      ))}
      <Button title="Done" variant="secondary" onPress={onDismiss} />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: Spacing.two },
  grow: { flex: 1 },
  card: { padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: Spacing.three, borderRadius: Spacing.three },
  pressed: { opacity: 0.7 },
});
