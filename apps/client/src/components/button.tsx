import { ActivityIndicator, Pressable, StyleSheet, type PressableProps } from 'react-native';

import { ThemedText } from './themed-text';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type ButtonProps = Omit<PressableProps, 'children'> & {
  title: string;
  variant?: 'primary' | 'secondary';
  loading?: boolean;
};

export function Button({ title, variant = 'primary', loading = false, disabled, style, ...rest }: ButtonProps) {
  const theme = useTheme();
  const primary = variant === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      aria-disabled={!!disabled || loading}
      aria-busy={loading}
      disabled={disabled || loading}
      style={(state) => [
        styles.button,
        { backgroundColor: primary ? theme.tint : theme.backgroundElement },
        (state.pressed || disabled) && styles.dim,
        typeof style === 'function' ? style(state) : style,
      ]}
      {...rest}>
      {loading ? (
        <ActivityIndicator color={primary ? theme.background : theme.text} />
      ) : (
        <ThemedText type="smallBold" style={{ color: primary ? theme.background : theme.text }}>
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
