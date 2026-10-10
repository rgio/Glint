import { HIGHLIGHT_MAX_SEC, HIGHLIGHT_MIN_SEC, HIGHLIGHT_NOTE_MAX, type Highlight, type HighlightSource } from '@podcast/shared';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { captureRange, newId, type LastCapture } from './capture';

import { usePlayer } from '@/player/store';
import type { PlayableEpisode } from '@/player/types';
import { persistStorage } from '@/storage/persist';

/** A message shown for a few seconds after a capture or a deletion, with Undo. */
export type HighlightToast = { kind: 'captured' | 'deleted'; id: string; at: number };

type HighlightsState = {
  /** Every highlight by id, including deleted ones (kept so the deletion syncs). */
  items: Record<string, Highlight>;
  /** Titles and artwork for the episodes highlights belong to, so lists work offline. */
  episodes: Record<string, PlayableEpisode>;
  lastCapture: LastCapture | null;
  toast: HighlightToast | null;
  /** The highlight whose note editor is open, if any. */
  editingNoteFor: string | null;

  /** Saves the last 30 seconds heard of the playing episode. Null if nothing is loaded. */
  capture(source: HighlightSource): Highlight | null;
  setNote(id: string, note: string): void;
  setRange(id: string, startSec: number, endSec: number): void;
  remove(id: string): void;
  /** Undo a capture (deletes it) or a deletion (brings back a copy). */
  undo(): void;
  openNote(id: string | null): void;
  dismissToast(): void;
};

export const useHighlights = create<HighlightsState>()(
  persist(
    (set, get) => {
      const update = (id: string, patch: Partial<Highlight>) => {
        const existing = get().items[id];
        if (existing) set({ items: { ...get().items, [id]: { ...existing, ...patch } } });
      };

      return {
        items: {},
        episodes: {},
        lastCapture: null,
        toast: null,
        editingNoteFor: null,

        capture(source) {
          const { current, positionSec, rate, durationSec } = usePlayer.getState();
          if (!current) return null;
          const now = Date.now();
          const range = captureRange({
            episodeId: current.id,
            positionSec,
            rate,
            durationSec: durationSec ?? current.durationSec,
            now,
            last: get().lastCapture,
          });

          if (range.kind === 'extend' && get().items[range.id] && !get().items[range.id]!.deleted) {
            update(range.id, { startSec: range.startSec, endSec: range.endSec, rangeUpdatedAt: now, transcriptExcerpt: null, chapterTitle: null, transcriptConfidence: null });
            set({ lastCapture: { ...get().lastCapture!, startSec: range.startSec, endSec: range.endSec, capturedAt: now }, toast: { kind: 'captured', id: range.id, at: now } });
            return get().items[range.id]!;
          }

          const highlight: Highlight = {
            id: newId(),
            episodeId: current.id,
            podcastId: current.podcastId,
            startSec: range.startSec,
            endSec: range.endSec,
            note: null,
            transcriptExcerpt: null,
            chapterTitle: null,
            anchorDurationSec: durationSec ?? current.durationSec,
            anchorEnclosureUrl: current.url,
            source,
            createdAt: now,
            rangeUpdatedAt: now,
            noteUpdatedAt: now,
            deleted: false,
          };
          set({
            items: { ...get().items, [highlight.id]: highlight },
            episodes: { ...get().episodes, [current.id]: current },
            lastCapture: { id: highlight.id, episodeId: current.id, startSec: highlight.startSec, endSec: highlight.endSec, capturedAt: now },
            toast: { kind: 'captured', id: highlight.id, at: now },
          });
          return highlight;
        },

        setNote(id, note) {
          const trimmed = note.trim().slice(0, HIGHLIGHT_NOTE_MAX);
          update(id, { note: trimmed || null, noteUpdatedAt: Date.now() });
        },

        setRange(id, startSec, endSec) {
          const h = get().items[id];
          if (!h) return;
          const duration = h.anchorDurationSec ?? Infinity;
          let start = Math.max(0, Math.min(startSec, duration - HIGHLIGHT_MIN_SEC));
          let end = Math.min(duration, Math.max(endSec, start + HIGHLIGHT_MIN_SEC));
          if (end - start > HIGHLIGHT_MAX_SEC) {
            // Keep the edge that didn't move.
            if (start !== h.startSec) start = end - HIGHLIGHT_MAX_SEC;
            else end = start + HIGHLIGHT_MAX_SEC;
          }
          // The excerpt and chapter belonged to the old range; the server recomputes them.
          update(id, { startSec: start, endSec: end, rangeUpdatedAt: Date.now(), transcriptExcerpt: null, chapterTitle: null, transcriptConfidence: null });
        },

        remove(id) {
          update(id, { deleted: true });
          set({ toast: { kind: 'deleted', id, at: Date.now() }, editingNoteFor: null });
        },

        undo() {
          const { toast, items } = get();
          const h = toast && items[toast.id];
          if (!toast || !h) return;
          if (toast.kind === 'captured') {
            update(h.id, { deleted: true });
          } else {
            // A deletion may already have synced, and deletions win, so restore as a new highlight.
            const now = Date.now();
            const copy = { ...h, id: newId(), deleted: false, rangeUpdatedAt: now, noteUpdatedAt: now };
            set({ items: { ...get().items, [copy.id]: copy } });
          }
          set({ toast: null, lastCapture: null });
        },

        openNote(id) {
          set({ editingNoteFor: id });
        },

        dismissToast() {
          set({ toast: null });
        },
      };
    },
    {
      name: 'highlights',
      version: 1,
      storage: persistStorage(),
      partialize: ({ items, episodes }) => ({ items, episodes }) as HighlightsState,
    },
  ),
);

/** Live highlights for an episode, in time order. */
export function useEpisodeHighlights(episodeId: string | undefined) {
  const items = useHighlights((s) => s.items);
  return Object.values(items)
    .filter((h) => !h.deleted && h.episodeId === episodeId)
    .sort((a, b) => a.startSec - b.startSec);
}
