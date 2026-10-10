import { SLEEP_TIMER_MINUTES } from '@podcast/shared';
import { Pressable, StyleSheet } from 'react-native';

import { Icon } from './icon';
import { ChoiceMenu, type MenuOption } from './menu';
import { ThemedText } from './themed-text';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatClock } from '@/lib/format';
import { usePlayer } from '@/player/store';

type Choice = number | 'endOfEpisode' | null;

const OPTIONS: MenuOption<Choice>[] = [
  ...SLEEP_TIMER_MINUTES.map((m) => ({ value: m, label: `${m} min` })),
  { value: 'endOfEpisode', label: 'End of episode' },
  { value: null, label: 'Off' },
];

/** F-14: shows the sleep timer's state (off, a countdown, or end of episode); tapping it opens the choices. */
export function SleepTimerMenu() {
  const theme = useTheme();
  const timer = usePlayer((s) => s.sleepTimer);
  const remainingSec = usePlayer((s) => s.sleepRemainingSec);
  const setSleepTimer = usePlayer((s) => s.setSleepTimer);
  const selected: Choice = timer ? (timer.kind === 'endOfEpisode' ? 'endOfEpisode' : timer.minutes) : null;

  const label = !timer
    ? 'Sleep'
    : timer.kind === 'endOfEpisode'
      ? 'End of episode'
      : formatClock(remainingSec ?? timer.minutes * 60);
  const color = timer ? theme.background : theme.text;

  return (
    <ChoiceMenu
      label="Sleep timer"
      options={OPTIONS}
      selected={selected}
      onChoose={setSleepTimer}
      trigger={({ open, onPress }) => (
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
          <Icon name="sleep" size={18} color={color} />
          <ThemedText type="smallBold" style={{ color }}>
            {label}
          </ThemedText>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    minHeight: 44,
    minWidth: 64,
    borderRadius: 22,
    paddingHorizontal: Spacing.three,
  },
  pressed: { opacity: 0.6 },
});
