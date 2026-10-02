import type { Podcast } from '@podcast/shared';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { persistStorage } from '@/storage/persist';

type LibraryState = {
  /** Subscribed podcasts, keyed by id, with when the listener subscribed. */
  subscriptions: Record<string, { podcast: Podcast; subscribedAt: number }>;
  /** When the listener last opened Home; drives the "New" section (F-11). */
  lastHomeVisitAt: number;
  toggleSubscription(podcast: Podcast): void;
  markHomeVisited(): void;
};

export const useLibrary = create<LibraryState>()(
  persist(
    (set, get) => ({
      subscriptions: {},
      lastHomeVisitAt: 0,

      toggleSubscription(podcast) {
        const { [podcast.id]: existing, ...rest } = get().subscriptions;
        set({
          subscriptions: existing ? rest : { ...rest, [podcast.id]: { podcast, subscribedAt: Date.now() } },
        });
      },

      markHomeVisited() {
        set({ lastHomeVisitAt: Date.now() });
      },
    }),
    {
      name: 'library',
      version: 1,
      storage: persistStorage(),
      partialize: ({ subscriptions, lastHomeVisitAt }) => ({ subscriptions, lastHomeVisitAt }),
    },
  ),
);
