import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { IconButton } from './icon';
import { ThemedText } from './themed-text';

import { shareEpisode } from '@/lib/share';

/** F-15: shares an episode's link; says "Link copied" when the browser copied it instead. */
export function ShareButton({ episode, size }: { episode: { id: string; title: string; podcastTitle: string }; size?: number }) {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), 2500);
    return () => clearTimeout(timer);
  }, [message]);

  const share = async () => {
    try {
      const outcome = await shareEpisode(episode);
      if (outcome === 'copied') setMessage('Link copied');
    } catch {
      setMessage("Couldn't share the link");
    }
  };

  return (
    <View style={styles.container}>
      <IconButton name="share" label="Share episode" size={size} onPress={share} />
      {message && (
        <ThemedText type="small" themeColor="textSecondary" accessibilityLiveRegion="polite" style={styles.message}>
          {message}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'center' },
  message: { marginLeft: 2 },
});
