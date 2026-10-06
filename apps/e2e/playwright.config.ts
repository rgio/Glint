import { defineConfig, devices } from '@playwright/test';

import { API_URL, WEB_PORT, WEB_URL } from './src/ports';

const CI = !!process.env.CI;

export default defineConfig({
  testDir: 'tests',
  // The production build has its own config: playwright.export.config.ts.
  testIgnore: 'export/**',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // One worker: the tests share one API (in memory) and one Metro bundler.
  workers: 1,
  retries: CI ? 1 : 0,
  reporter: CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  globalSetup: './src/warm-up.ts',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: WEB_URL,
    viewport: { width: 1280, height: 900 },
    trace: 'retain-on-failure',
    // Muted, and allowed to start audio without a user gesture first.
    launchOptions: { args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] },
  },
  webServer: [
    {
      command: 'tsx src/stack.ts',
      url: `${API_URL}/health`,
      reuseExistingServer: !CI,
      timeout: 60_000,
    },
    {
      command: `npx expo start --web --port ${WEB_PORT}`,
      cwd: '../client',
      url: WEB_URL,
      // CI=1 keeps Expo non-interactive; the API address is baked into the bundle.
      env: { EXPO_PUBLIC_API_URL: API_URL, CI: '1' },
      reuseExistingServer: !CI,
      timeout: 180_000,
    },
  ],
});
