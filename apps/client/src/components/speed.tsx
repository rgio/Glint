import { MIN_RATE } from '@podcast/shared';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from './themed-text';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { audioPlayer } from '@/player/audio-player';
import { RATE_PRESETS, usePlayer } from '@/player/store';

/** F-06: shows the playback speed and opens its options. */
export function SpeedButton({ open, onPress }: { open: boolean; onPress: () => void }) {
  const theme = useTheme();
  const rate = usePlayer((s) => s.rate);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Playback speed ${rate}x. Change speed`}
      aria-expanded={open}
      onPress={onPress}
      style={({ pressed }) => [
        styles.pill,
        { backgroundColor: open ? theme.backgroundSelected : theme.backgroundElement },
        pressed && styles.pressed,
      ]}>
      <ThemedText type="smallBold">{`${rate}x`}</ThemedText>
    </Pressable>
  );
}

/** Speed in 0.1x steps, plus one-tap presets. Stays open so the listener can fine-tune by ear. */
export function SpeedOptions() {
  const theme = useTheme();
  const rate = usePlayer((s) => s.rate);
  const { setRate, stepRate } = usePlayer.getState();
  const presets = RATE_PRESETS.filter((r) => r <= audioPlayer.maxRate);

  return (
    <View style={styles.panel}>
      <View style={styles.stepper}>
        <StepButton label="Slower" symbol="−" disabled={rate <= MIN_RATE} onPress={() => stepRate(-1)} />
        <ThemedText type="subtitle" style={styles.value} accessibilityLiveRegion="polite">
          {`${rate.toFixed(1)}x`}
        </ThemedText>
        <StepButton label="Faster" symbol="+" disabled={rate >= audioPlayer.maxRate} onPress={() => stepRate(1)} />
      </View>
      <View role="radiogroup" aria-label="Playback speed" style={styles.options}>
        {presets.map((preset) => {
          const active = preset === rate;
          return (
            <Pressable
              key={preset}
              role="radio"
              aria-checked={active}
              aria-label={`${preset}x`}
              onPress={() => setRate(preset)}
              style={({ pressed }) => [
                styles.option,
                { backgroundColor: active ? theme.tint : theme.backgroundElement },
                pressed && styles.pressed,
              ]}>
              <ThemedText type="small" style={active ? { color: theme.background } : undefined}>
                {`${preset}x`}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function StepButton({ label, symbol, disabled, onPress }: { label: string; symbol: string; disabled: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label} by 0.1x`}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.step,
        { backgroundColor: theme.backgroundElement },
        (pressed || disabled) && styles.pressed,
      ]}>
      <ThemedText type="subtitle">{symbol}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: { minWidth: 64, minHeight: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.three },
  panel: { alignItems: 'center', gap: Spacing.three, maxWidth: 600 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: Spacing.four },
  value: { minWidth: 80, textAlign: 'center' },
  step: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  options: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: Spacing.two },
  option: { minHeight: 36, justifyContent: 'center', paddingHorizontal: Spacing.three, borderRadius: 18 },
  pressed: { opacity: 0.6 },
});
