import {
  Tabs,
  TabList,
  TabTrigger,
  TabSlot,
  TabTriggerSlotProps,
  TabListProps,
} from 'expo-router/ui';
import { Pressable, View, StyleSheet, useWindowDimensions } from 'react-native';

import { ThemedText } from './themed-text';
import { ThemedView } from './themed-view';

import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { badgeText, useUnplayedNewCount } from '@/library/new-episodes';

/** Below this width the brand name is dropped and the tabs share the bar evenly so they fit on a phone. */
const COMPACT_MAX_WIDTH = 560;

function useCompact() {
  return useWindowDimensions().width < COMPACT_MAX_WIDTH;
}

export default function AppTabs() {
  const homeBadge = badgeText(useUnplayedNewCount());
  return (
    <Tabs>
      <TabSlot style={{ height: '100%' }} />
      <TabList asChild>
        <CustomTabList>
          <TabTrigger name="index" href="/" asChild>
            <TabButton badge={homeBadge}>Home</TabButton>
          </TabTrigger>
          <TabTrigger name="discover" href="/discover" asChild>
            <TabButton>Discover</TabButton>
          </TabTrigger>
          <TabTrigger name="library" href="/library" asChild>
            <TabButton>Library</TabButton>
          </TabTrigger>
          <TabTrigger name="queue" href="/queue" asChild>
            <TabButton>Up Next</TabButton>
          </TabTrigger>
        </CustomTabList>
      </TabList>
    </Tabs>
  );
}

/** A tab. `badge` (F-11: new episodes on Home) shows only while the tab isn't open. */
export function TabButton({ children, isFocused, badge, ...props }: TabTriggerSlotProps & { badge?: string }) {
  const compact = useCompact();
  const theme = useTheme();
  const showBadge = badge && !isFocused;
  return (
    <Pressable
      {...props}
      accessibilityLabel={showBadge ? `${children}, ${badge} new episodes` : undefined}
      style={({ pressed }) => [compact && styles.compactTab, pressed && styles.pressed]}>
      <ThemedView
        type={isFocused ? 'backgroundSelected' : 'backgroundElement'}
        style={[styles.tabButtonView, compact && styles.compactTabView]}>
        <ThemedText type="small" themeColor={isFocused ? 'text' : 'textSecondary'}>
          {children}
        </ThemedText>
        {showBadge && (
          <View style={[styles.badge, { backgroundColor: theme.tint }]}>
            <ThemedText type="smallBold" style={[styles.badgeText, { color: theme.background }]}>
              {badge}
            </ThemedText>
          </View>
        )}
      </ThemedView>
    </Pressable>
  );
}

export function CustomTabList(props: TabListProps) {
  const compact = useCompact();
  return (
    <View {...props} style={[styles.tabListContainer, compact && styles.compactListContainer]}>
      <ThemedView type="backgroundElement" style={[styles.innerContainer, compact && styles.compactInner]}>
        {!compact && (
          <ThemedText type="smallBold" style={styles.brandText}>
            Podcast
          </ThemedText>
        )}
        {props.children}
      </ThemedView>
    </View>
  );
}

const styles = StyleSheet.create({
  tabListContainer: {
    position: 'absolute',
    width: '100%',
    padding: Spacing.three,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
  },
  innerContainer: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.five,
    borderRadius: Spacing.five,
    flexDirection: 'row',
    alignItems: 'center',
    flexGrow: 1,
    gap: Spacing.two,
    maxWidth: MaxContentWidth,
  },
  brandText: {
    marginRight: 'auto',
  },
  pressed: {
    opacity: 0.7,
  },
  tabButtonView: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  badge: { minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, justifyContent: 'center' },
  badgeText: { fontSize: 11, lineHeight: 18, textAlign: 'center' },
  compactListContainer: { paddingHorizontal: Spacing.two },
  compactInner: { paddingHorizontal: Spacing.one, gap: Spacing.one },
  compactTab: { flex: 1 },
  compactTabView: { paddingHorizontal: Spacing.one, justifyContent: 'center' },
});
