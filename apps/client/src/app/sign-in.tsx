import { useQuery } from '@tanstack/react-query';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, StyleSheet } from 'react-native';

import { verifySignIn } from '@/auth/session';
import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Where the link in a sign-in email lands (web). It signs in, then goes to Settings. */
export default function SignInLinkScreen() {
  const theme = useTheme();
  const { token } = useLocalSearchParams<{ token?: string }>();
  const result = useQuery({
    queryKey: ['sign-in-link', token],
    queryFn: () => verifySignIn({ token: token! }),
    enabled: !!token,
    // A link works once: never retry or refetch it.
    retry: false,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
  });

  if (result.isSuccess) return <Redirect href="/settings" />;

  return (
    <ThemedView style={styles.center}>
      {!token || result.isError ? (
        <>
          <ThemedText style={{ color: theme.danger }}>
            {result.error?.message ?? 'This sign-in link is incomplete.'}
          </ThemedText>
          <Button title="Go to Settings" variant="secondary" onPress={() => router.replace('/settings')} />
        </>
      ) : (
        <ActivityIndicator accessibilityLabel="Signing in" />
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three, padding: Spacing.four },
});
