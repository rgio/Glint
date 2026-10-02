import { Image } from 'expo-image';
import { StyleSheet } from 'react-native';

import { ThemedView } from './themed-view';

export function Artwork({ uri, size }: { uri: string | null; size: number }) {
  const frame = { width: size, height: size, borderRadius: Math.max(6, size / 12) };
  if (!uri) return <ThemedView type="backgroundElement" style={frame} />;
  return (
    <Image
      source={{ uri }}
      style={[frame, styles.image]}
      contentFit="cover"
      transition={150}
      accessibilityIgnoresInvertColors
    />
  );
}

const styles = StyleSheet.create({
  image: { overflow: 'hidden' },
});
