import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { HighlightOverlay } from '@/components/highlights';
import { useKeyboardShortcuts } from '@/components/keyboard-shortcuts';
import { WebPlayerBar } from '@/components/web-player-bar';
import { startSync } from '@/sync/engine';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 5 * 60_000, retry: 2 } } }),
  );

  useKeyboardShortcuts();

  // F-13: sync starts once saved state has loaded; it does nothing while signed out.
  useEffect(() => {
    void startSync();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <AnimatedSplashOverlay />
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="podcast/[id]" options={{ title: '', headerBackTitle: 'Back' }} />
          <Stack.Screen name="episode/[id]" options={{ title: '', headerBackTitle: 'Back' }} />
          <Stack.Screen name="player" options={{ presentation: 'modal', title: 'Now Playing' }} />
          <Stack.Screen name="settings" options={{ title: 'Settings', headerBackTitle: 'Back' }} />
          <Stack.Screen name="sign-in" options={{ title: 'Signing in', headerBackTitle: 'Back' }} />
          <Stack.Screen name="highlights" options={{ title: 'Highlights', headerBackTitle: 'Back' }} />
        </Stack>
        <WebPlayerBar />
        <HighlightOverlay />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
