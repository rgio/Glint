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

/** Below this width the brand name is dropped and the tabs share the bar evenly so they fit on a phone. */
const COMPACT_MAX_WIDTH = 560;

function useCompact() {
  return useWindowDimensions().width < COMPACT_MAX_WIDTH;
}

export default function AppTabs() {
  return (
    <Tabs>
      <TabSlot style={{ height: '100%' }} />
      <TabList asChild>
        <CustomTabList>
          <TabTrigger name="index" href="/" asChild>
            <TabButton>Home</TabButton>
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

export function TabButton({ children, isFocused, ...props }: TabTriggerSlotProps) {
  const compact = useCompact();
  return (
    <Pressable {...props} style={({ pressed }) => [compact && styles.compactTab, pressed && styles.pressed]}>
      <ThemedView
        type={isFocused ? 'backgroundSelected' : 'backgroundElement'}
        style={[styles.tabButtonView, compact && styles.compactTabView]}>
        <ThemedText type="small" themeColor={isFocused ? 'text' : 'textSecondary'}>
          {children}
        </ThemedText>
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
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  compactListContainer: { paddingHorizontal: Spacing.two },
  compactInner: { paddingHorizontal: Spacing.one, gap: Spacing.one },
  compactTab: { flex: 1 },
  compactTabView: { paddingHorizontal: Spacing.one, alignItems: 'center' },
});
