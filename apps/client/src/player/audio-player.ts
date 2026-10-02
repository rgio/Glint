// Type-checking entry point only. Metro resolves `audio-player.native.ts` on
// iOS/Android and `audio-player.web.ts` on web, so this file is never bundled.
export { audioPlayer } from './audio-player.native';
