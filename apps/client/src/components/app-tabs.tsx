import { usePathname } from 'expo-router';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { Platform, StyleSheet, useColorScheme, View } from 'react-native';

import { MiniPlayer } from './mini-player';

import { BottomTabInset, Colors } from '@/constants/theme';
import { badgeText, useUnplayedNewCount } from '@/library/new-episodes';
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

  return (
    <View style={styles.fill}>
      <NativeTabs
        backgroundColor={colors.background}
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
        <NativeTabs.Trigger name="queue">
          <NativeTabs.Trigger.Label>Up Next</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf="list.bullet" md="queue_music" />
        </NativeTabs.Trigger>

        {/* iOS shows the mini player as the tab bar's bottom accessory. */}
        {Platform.OS === 'ios' && hasEpisode && (
          <NativeTabs.BottomAccessory>
            <AccessoryPlayer />
          </NativeTabs.BottomAccessory>
        )}
      </NativeTabs>

      {Platform.OS === 'android' && hasEpisode && (
        <View style={[styles.androidPlayer, { backgroundColor: colors.backgroundElement }]}>
          <MiniPlayer />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  androidPlayer: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: BottomTabInset + 8,
    height: 56,
    borderRadius: 12,
    overflow: 'hidden',
  },
});
