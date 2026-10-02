import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useState } from 'react';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { WebPlayerBar } from '@/components/web-player-bar';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 5 * 60_000, retry: 2 } } }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <AnimatedSplashOverlay />
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="podcast/[id]" options={{ title: '', headerBackTitle: 'Back' }} />
          <Stack.Screen name="episode/[id]" options={{ title: '', headerBackTitle: 'Back' }} />
          <Stack.Screen name="player" options={{ presentation: 'modal', title: 'Now Playing' }} />
        </Stack>
        <WebPlayerBar />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
