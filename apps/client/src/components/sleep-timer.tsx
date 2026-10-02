import { SLEEP_TIMER_MINUTES } from '@podcast/shared';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from './icon';
import { ThemedText } from './themed-text';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatClock } from '@/lib/format';
import { usePlayer } from '@/player/store';

const OPTIONS: { value: number | 'endOfEpisode' | null; label: string }[] = [
  ...SLEEP_TIMER_MINUTES.map((m) => ({ value: m, label: `${m} min` })),
  { value: 'endOfEpisode', label: 'End of episode' },
  { value: null, label: 'Off' },
];

/** F-14: shows the sleep timer's state (off, a countdown, or end of episode) and opens its options. */
export function SleepTimerButton({ open, onPress }: { open: boolean; onPress: () => void }) {
  const theme = useTheme();
  const timer = usePlayer((s) => s.sleepTimer);
  const remainingSec = usePlayer((s) => s.sleepRemainingSec);

  const label = !timer
    ? 'Sleep timer'
    : timer.kind === 'endOfEpisode'
      ? 'End of episode'
      : formatClock(remainingSec ?? timer.minutes * 60);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={timer ? `Sleep timer: ${label}. Change` : 'Sleep timer: off. Set'}
      aria-expanded={open}
      onPress={onPress}
      style={({ pressed }) => [
        styles.pill,
        { backgroundColor: timer ? theme.tint : theme.backgroundElement },
        pressed && styles.pressed,
      ]}>
      <Icon name="sleep" size={18} color={timer ? theme.background : theme.text} />
      <ThemedText type="smallBold" style={{ color: timer ? theme.background : theme.text }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

/** The sleep timer choices. Choosing one sets the timer and calls `onChoose`. */
export function SleepTimerOptions({ onChoose }: { onChoose: () => void }) {
  const theme = useTheme();
  const timer = usePlayer((s) => s.sleepTimer);
  const setSleepTimer = usePlayer((s) => s.setSleepTimer);
  const selected = timer ? (timer.kind === 'endOfEpisode' ? 'endOfEpisode' : timer.minutes) : null;

  return (
    <View role="radiogroup" aria-label="Sleep timer" style={styles.options}>
      {OPTIONS.map((option) => {
        const active = option.value === selected;
        return (
          <Pressable
            key={option.label}
            role="radio"
            aria-checked={active}
            onPress={() => {
              setSleepTimer(option.value);
              onChoose();
            }}
            style={({ pressed }) => [
              styles.option,
              { backgroundColor: active ? theme.backgroundSelected : theme.backgroundElement },
              pressed && styles.pressed,
            ]}>
            <ThemedText type="small">{option.label}</ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    minHeight: 44,
    borderRadius: 22,
    paddingHorizontal: Spacing.three,
  },
  options: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: Spacing.two, maxWidth: 480 },
  option: { minHeight: 36, justifyContent: 'center', paddingHorizontal: Spacing.three, borderRadius: 18 },
  pressed: { opacity: 0.6 },
});
