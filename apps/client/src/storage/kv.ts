// Type-checking entry point only. Metro resolves `kv.native.ts` on
// iOS/Android and `kv.web.ts` on web, so this file is never bundled.
export { kv } from './kv.native';
