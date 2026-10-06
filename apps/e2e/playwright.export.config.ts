import { defineConfig } from '@playwright/test';

import base from './playwright.config';
import { API_URL, WEB_PORT, WEB_URL } from './src/ports';

/**
 * The production web build: `expo export`, served with the hosting rules from docs/deploy.md.
 * Catches what the dev server can't show, like pages whose pre-rendered HTML doesn't match the
 * app (React then throws the page away and renders it again).
 */
export default defineConfig({
  ...base,
  testDir: 'tests/export',
  testIgnore: [],
  globalSetup: undefined,
  webServer: [
    base.webServer instanceof Array ? base.webServer[0]! : base.webServer!,
    {
      // --clear: Metro's cache can keep an earlier build's EXPO_PUBLIC_API_URL.
      command: `pnpm --filter @podcast/client exec expo export --platform web --clear --output-dir ../e2e/.web-export && tsx src/serve-export.ts .web-export`,
      url: WEB_URL,
      env: { EXPO_PUBLIC_API_URL: API_URL, CI: '1' },
      reuseExistingServer: false,
      timeout: 300_000,
    },
  ],
  metadata: { webPort: WEB_PORT },
});
