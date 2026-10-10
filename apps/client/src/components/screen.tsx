import type { ReactNode } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from './themed-text';
import { ThemedView } from './themed-view';

import { BottomTabInset, MaxContentWidth, Spacing, WebPlayerHeight, WebTabBarHeight } from '@/constants/theme';
import { FloatingPlayerGap, FloatingPlayerHeight } from '@/player/placement';
import { usePlayer } from '@/player/store';

/** Padding that keeps content clear of the tab bar, mini player and notches on each platform. */
export function useContentInsets() {
  const safe = useSafeAreaInsets();
  const hasEpisode = usePlayer((s) => s.current !== null);
  if (Platform.OS === 'web') {
    return {
      paddingTop: WebTabBarHeight + Spacing.three,
      paddingBottom: (hasEpisode ? WebPlayerHeight : 0) + Spacing.four,
    };
  }
  // Room for the floating player (shown on most screens; iOS 26 tab screens get a little extra).
  const floatingPlayer = hasEpisode ? FloatingPlayerHeight + FloatingPlayerGap : 0;
  return {
    paddingTop: safe.top + Spacing.three,
    paddingBottom: safe.bottom + BottomTabInset + floatingPlayer + Spacing.four,
  };
}

/**
 * Scrolling tab screen with a large title, centered and width-capped on wide screens.
 * `headerRight` sits at the right end of the title row (e.g. a settings button).
 */
export function TabScreen({ title, headerRight, children }: { title: string; headerRight?: ReactNode; children: ReactNode }) {
  const insets = useContentInsets();
  return (
    <ThemedView style={styles.fill}>
      <ScrollView contentContainerStyle={[styles.content, insets]}>
        <View style={styles.column}>
          <View style={styles.titleRow}>
            <ThemedText type="subtitle" accessibilityRole="header" style={styles.title}>
              {title}
            </ThemedText>
            {headerRight}
          </View>
          {children}
        </View>
      </ScrollView>
    </ThemedView>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <ThemedText type="smallBold" themeColor="textSecondary" accessibilityRole="header" style={styles.section}>
      {children}
    </ThemedText>
  );
}

export function EmptyState({ title, body, children }: { title: string; body: string; children?: ReactNode }) {
  return (
    <ThemedView type="backgroundElement" style={styles.empty}>
      <ThemedText type="smallBold">{title}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {body}
      </ThemedText>
      {children}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { paddingHorizontal: Spacing.three, alignItems: 'center' },
  column: { width: '100%', maxWidth: MaxContentWidth, gap: Spacing.two },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  title: { flex: 1 },
  section: { marginTop: Spacing.four, textTransform: 'uppercase', letterSpacing: 0.5 },
  empty: { padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.one },
});
