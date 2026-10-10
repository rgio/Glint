import { usePathname } from 'expo-router';
import { Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MiniPlayer } from './mini-player';

import { BottomTabInset } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { FloatingPlayerGap, FloatingPlayerHeight, isTabPath, showsFloatingPlayer } from '@/player/placement';
import { usePlayer } from '@/player/store';

/**
 * The mini player, floating above the tab bar, or above the bottom edge on pushed screens. It
 * lives in the root layout so it stays on every screen while something is playing.
 */
export function PlayerBar() {
  const theme = useTheme();
  const hasEpisode = usePlayer((s) => s.current !== null);
  const pathname = usePathname();
  const safeBottom = useSafeAreaInsets().bottom;

  if (!hasEpisode || !showsFloatingPlayer(pathname)) return null;

  // The iOS tab bar sits above the home indicator; Android's tab bar height already covers it.
  const tabBar = isTabPath(pathname) ? BottomTabInset : 0;
  const bottom = tabBar + FloatingPlayerGap + (Platform.OS === 'ios' || !tabBar ? safeBottom : 0);

  return (
    <View style={[styles.bar, { bottom, backgroundColor: theme.backgroundElement }]}>
      <MiniPlayer />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 8,
    right: 8,
    height: FloatingPlayerHeight,
    borderRadius: 12,
    overflow: 'hidden',
  },
});
