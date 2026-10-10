import { usePathname } from 'expo-router';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { StyleSheet, useColorScheme, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MiniPlayer } from './mini-player';

import { Colors } from '@/constants/theme';
import { badgeText, useUnplayedNewCount } from '@/library/new-episodes';
import { usesTabBarAccessory } from '@/player/placement';
import { usePlayer } from '@/player/store';

function AccessoryPlayer() {
  const placement = NativeTabs.BottomAccessory.usePlacement();
  return <MiniPlayer compact={placement === 'inline'} />;
}

export default function AppTabs() {
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'unspecified' ? 'light' : scheme];
  const hasEpisode = usePlayer((s) => s.current !== null);
  // F-11: new, unplayed episodes, shown on the Home tab while another tab is open.
  const homeBadge = badgeText(useUnplayedNewCount());
  const onHome = usePathname() === '/';
  const safeTop = useSafeAreaInsets().top;

  return (
    <View style={styles.fill}>
      <NativeTabs
        backgroundColor={colors.background}
        // Keep the tab bar opaque: the screens wrap their scroll views, so iOS can't tell when a
        // list is scrolled to the end and would otherwise leave the bar see-through over content.
        disableTransparentOnScrollEdge
        indicatorColor={colors.backgroundElement}
        labelStyle={{ selected: { color: colors.text } }}>
        <NativeTabs.Trigger name="index">
          <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf="house.fill" md="home" />
          <NativeTabs.Trigger.Badge hidden={!homeBadge || onHome}>{homeBadge}</NativeTabs.Trigger.Badge>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="discover">
          <NativeTabs.Trigger.Label>Discover</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf="magnifyingglass" md="search" />
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="library">
          <NativeTabs.Trigger.Label>Library</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf="square.stack.fill" md="library_music" />
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="highlights">
          <NativeTabs.Trigger.Label>Highlights</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf="highlighter" md="ink_highlighter" />
        </NativeTabs.Trigger>

        {/* iOS 26+ shows the mini player as the tab bar's bottom accessory; elsewhere see PlayerBar. */}
        {usesTabBarAccessory && hasEpisode && (
          <NativeTabs.BottomAccessory>
            <AccessoryPlayer />
          </NativeTabs.BottomAccessory>
        )}
      </NativeTabs>

      {/* The tab screens have no header, so lists would scroll under the status bar. */}
      <View pointerEvents="none" style={[styles.statusBar, { height: safeTop, backgroundColor: colors.background }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  statusBar: { position: 'absolute', top: 0, left: 0, right: 0 },
});
