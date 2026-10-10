import type { HighlightSource } from '@podcast/shared';
import { router } from 'expo-router';

/**
 * Opens the highlight editor: `{ source }` for a new highlight of what's playing (from that
 * button), or `{ id }` to edit a saved one.
 */
export function openHighlightEditor(target: { id: string } | { source: HighlightSource }) {
  router.push({ pathname: '/note', params: target });
}
