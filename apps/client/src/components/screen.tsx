import type { ReactNode } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from './themed-text';
import { ThemedView } from './themed-view';

import { BottomTabInset, MaxContentWidth, Spacing, WebPlayerHeight, WebTabBarHeight } from '@/constants/theme';
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
  const androidPlayer = Platform.OS === 'android' && hasEpisode ? 64 : 0;
  return {
    paddingTop: safe.top + Spacing.three,
    paddingBottom: safe.bottom + BottomTabInset + androidPlayer + Spacing.four,
  };
}

/** Scrolling tab screen with a large title, centered and width-capped on wide screens. */
export function TabScreen({ title, children }: { title: string; children: ReactNode }) {
  const insets = useContentInsets();
  return (
    <ThemedView style={styles.fill}>
      <ScrollView contentContainerStyle={[styles.content, insets]}>
        <View style={styles.column}>
          <ThemedText type="subtitle" accessibilityRole="header">
            {title}
          </ThemedText>
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
  section: { marginTop: Spacing.four, textTransform: 'uppercase', letterSpacing: 0.5 },
  empty: { padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.one },
});
