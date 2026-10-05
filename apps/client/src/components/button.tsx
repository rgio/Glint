import { ActivityIndicator, Pressable, StyleSheet, type PressableProps } from 'react-native';

import { ThemedText } from './themed-text';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type ButtonProps = Omit<PressableProps, 'children'> & {
  title: string;
  /** `danger` is for actions that destroy something and can't be undone. */
  variant?: 'primary' | 'secondary' | 'danger';
  loading?: boolean;
};

export function Button({ title, variant = 'primary', loading = false, disabled, style, ...rest }: ButtonProps) {
  const theme = useTheme();
  const filled = variant !== 'secondary';
  const fill = variant === 'danger' ? theme.danger : variant === 'primary' ? theme.tint : theme.backgroundElement;
  return (
    <Pressable
      accessibilityRole="button"
      aria-disabled={!!disabled || loading}
      aria-busy={loading}
      disabled={disabled || loading}
      style={(state) => [
        styles.button,
        { backgroundColor: fill },
        (state.pressed || disabled) && styles.dim,
        typeof style === 'function' ? style(state) : style,
      ]}
      {...rest}>
      {loading ? (
        <ActivityIndicator color={filled ? theme.background : theme.text} />
      ) : (
        <ThemedText type="smallBold" style={{ color: filled ? theme.background : theme.text }}>
          {title}
        </ThemedText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 44,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dim: { opacity: 0.6 },
});
