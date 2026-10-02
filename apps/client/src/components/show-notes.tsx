import { useMemo } from 'react';
import { Linking, StyleSheet, Text, View, type TextStyle } from 'react-native';

import { ThemedText } from './themed-text';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { parseShowNotes, type Inline } from '@/lib/show-notes';

/**
 * F-05: show notes rendered natively from a sanitized subset of their HTML (see
 * `parseShowNotes`). Timestamps call `onSeek`; links open in the browser.
 */
export function ShowNotes({
  html,
  durationSec,
  onSeek,
}: {
  html: string | null;
  durationSec: number | null;
  onSeek: (seconds: number) => void;
}) {
  const theme = useTheme();
  const blocks = useMemo(() => parseShowNotes(html, durationSec), [html, durationSec]);

  // Runs are plain Text, so they inherit the font and colour of the block around them.
  const renderInlines = (inlines: Inline[]) =>
    inlines.map((inline, i) => {
      if (inline.kind === 'break') return '\n';
      const emphasis: TextStyle = {
        fontWeight: inline.bold ? '700' : undefined,
        fontStyle: inline.italic ? 'italic' : undefined,
      };
      if (inline.kind === 'timestamp') {
        return (
          <Text
            key={i}
            accessibilityRole="button"
            accessibilityLabel={`Play from ${inline.text}`}
            onPress={() => onSeek(inline.seconds)}
            style={[emphasis, styles.timestamp, { color: theme.tint }]}>
            {inline.text}
          </Text>
        );
      }
      if (inline.href) {
        const href = inline.href;
        return (
          <Text
            key={i}
            accessibilityRole="link"
            onPress={() => void Linking.openURL(href)}
            style={[emphasis, styles.link, { color: theme.tint }]}>
            {inline.text}
          </Text>
        );
      }
      return (
        <Text key={i} style={emphasis}>
          {inline.text}
        </Text>
      );
    });

  if (blocks.length === 0) {
    return (
      <ThemedText type="small" themeColor="textSecondary">
        No show notes for this episode.
      </ThemedText>
    );
  }

  return (
    <View style={styles.notes}>
      {blocks.map((block, i) => {
        if (block.kind === 'list') {
          return (
            <View key={i} style={styles.list}>
              {block.items.map((item, j) => (
                <View key={j} style={styles.listItem}>
                  <ThemedText style={styles.marker}>{block.ordered ? `${j + 1}.` : '•'}</ThemedText>
                  <ThemedText style={styles.listText}>{renderInlines(item)}</ThemedText>
                </View>
              ))}
            </View>
          );
        }
        if (block.kind === 'quote') {
          return (
            <View key={i} style={[styles.quote, { borderLeftColor: theme.border }]}>
              <ThemedText themeColor="textSecondary">{renderInlines(block.inlines)}</ThemedText>
            </View>
          );
        }
        return (
          <ThemedText
            key={i}
            type={block.kind === 'heading' ? 'smallBold' : 'default'}
            accessibilityRole={block.kind === 'heading' ? 'header' : undefined}
            style={block.kind === 'heading' && styles.heading}>
            {renderInlines(block.inlines)}
          </ThemedText>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  notes: { gap: Spacing.three },
  heading: { fontSize: 18, lineHeight: 24, marginTop: Spacing.two },
  link: { textDecorationLine: 'underline' },
  timestamp: { fontVariant: ['tabular-nums'], fontWeight: '600' },
  list: { gap: Spacing.two },
  listItem: { flexDirection: 'row', gap: Spacing.two },
  marker: { minWidth: 20, textAlign: 'right' },
  listText: { flex: 1 },
  quote: { borderLeftWidth: 3, paddingLeft: Spacing.three },
});
