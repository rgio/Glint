import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, type PressableProps } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

// SF Symbols on iOS, Material Symbols on Android and web.
const ICONS = {
  play: { ios: 'play.fill', android: 'play_arrow', web: 'play_arrow' },
  pause: { ios: 'pause.fill', android: 'pause', web: 'pause' },
  skipBack: { ios: 'gobackward', android: 'fast_rewind', web: 'fast_rewind' },
  skipForward: { ios: 'goforward', android: 'fast_forward', web: 'fast_forward' },
  playNext: { ios: 'text.line.first.and.arrowtriangle.forward', android: 'playlist_play', web: 'playlist_play' },
  playLast: { ios: 'text.line.last.and.arrowtriangle.forward', android: 'playlist_add', web: 'playlist_add' },
  remove: { ios: 'xmark', android: 'close', web: 'close' },
  up: { ios: 'chevron.up', android: 'keyboard_arrow_up', web: 'keyboard_arrow_up' },
  down: { ios: 'chevron.down', android: 'keyboard_arrow_down', web: 'keyboard_arrow_down' },
  check: { ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' },
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 22, color }: { name: IconName; size?: number; color?: string }) {
  const theme = useTheme();
  return <SymbolView name={ICONS[name]} size={size} tintColor={color ?? theme.text} />;
}

type IconButtonProps = Omit<PressableProps, 'children'> & {
  name: IconName;
  /** Required: icon-only buttons need a spoken label. */
  label: string;
  size?: number;
  color?: string;
};

/** Icon button with a 44 pt minimum touch target (spec: accessibility). */
export function IconButton({ name, label, size, color, style, ...rest }: IconButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      style={(state) => [styles.button, state.pressed && styles.pressed, typeof style === 'function' ? style(state) : style]}
      {...rest}>
      <Icon name={name} size={size} color={color} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.5 },
});
