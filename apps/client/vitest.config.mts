import { defineConfig } from 'vitest/config';

// Unit tests for plain logic modules (no React Native rendering).
export default defineConfig({
  test: { include: ['src/**/*.test.ts'] },
});
