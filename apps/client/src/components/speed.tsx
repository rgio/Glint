import { RATE_PRESETS } from '@podcast/shared';
import { Pressable, StyleSheet } from 'react-native';

import { ChoiceMenu } from './menu';
import { ThemedText } from './themed-text';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { audioPlayer } from '@/player/audio-player';
import { usePlayer } from '@/player/store';

const formatRate = (rate: number) => `${rate}x`;

/** F-06: shows the playback speed; tapping it opens the speeds to choose from. */
export function SpeedMenu() {
  const theme = useTheme();
  const rate = usePlayer((s) => s.rate);
  const setRate = usePlayer((s) => s.setRate);
  const options = RATE_PRESETS.filter((r) => r <= audioPlayer.maxRate).map((r) => ({ value: r as number, label: formatRate(r) }));

  return (
    <ChoiceMenu
      label="Playback speed"
      options={options}
      selected={rate}
      onChoose={setRate}
      trigger={({ open, onPress }) => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Playback speed ${formatRate(rate)}. Change speed`}
          aria-expanded={open}
          onPress={onPress}
          style={({ pressed }) => [
            styles.pill,
            { backgroundColor: open ? theme.backgroundSelected : theme.backgroundElement },
            pressed && styles.pressed,
          ]}>
          <ThemedText type="smallBold">{formatRate(rate)}</ThemedText>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  pill: { minWidth: 64, minHeight: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.three },
  pressed: { opacity: 0.6 },
});
