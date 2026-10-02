import { usePathname } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { MiniPlayer } from './mini-player';
import { ThemedView } from './themed-view';

import { MaxContentWidth, WebPlayerHeight } from '@/constants/theme';
import { usePlayer } from '@/player/store';

/**
 * Mini player pinned to the bottom of every web page. It lives in the root
 * layout rather than the tab layout so it stays visible on pushed screens
 * like a show page.
 */
export function WebPlayerBar() {
  const hasEpisode = usePlayer((s) => s.current !== null);
  const pathname = usePathname();

  // The full player already has every control.
  if (!hasEpisode || pathname === '/player') return null;

  return (
    <ThemedView type="backgroundElement" style={styles.player}>
      <View style={styles.playerInner}>
        <MiniPlayer />
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  player: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: WebPlayerHeight,
    alignItems: 'center',
  },
  playerInner: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
  },
});
