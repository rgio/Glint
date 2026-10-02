import {
  clampRate,
  POSITION_SAVE_INTERVAL_MS,
  shouldMarkPlayed,
  sleepFadeVolume,
  sleepTimerRemainingMs,
  sortKeyAfter,
  sortKeyBefore,
  sortKeyBetween,
  type SleepTimer,
} from '@podcast/shared';
import { AppState } from 'react-native';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { persistStorage } from '@/storage/persist';

import { audioPlayer } from './audio-player';
import type { PlayableEpisode } from './types';

export type QueueEntry = PlayableEpisode & { sortKey: string };
export type SavedState = { positionSec: number; played: boolean; updatedAt: number };

const RATE_PRESETS = [1, 1.2, 1.5, 1.8, 2, 2.5, 3];

type PlayerState = {
  current: PlayableEpisode | null;
  positionSec: number;
  durationSec: number | null;
  playing: boolean;
  buffering: boolean;
  /** Whether `current` is loaded in the audio engine. False after a restart restores it from storage. */
  loaded: boolean;
  error: string | null;
  rate: number;
  skipBackSec: number;
  skipForwardSec: number;
  /** Up Next, ordered by sortKey. Does not include the current episode. */
  queue: QueueEntry[];
  /** Saved positions and played marks, keyed by episode id. */
  saved: Record<string, SavedState>;
  /** F-14. Not persisted: a sleep timer shouldn't outlive the app session. */
  sleepTimer: SleepTimer | null;
  /** Whole seconds until the sleep timer stops playback, for the countdown; null if unknown or off. */
  sleepRemainingSec: number | null;

  playEpisode(episode: PlayableEpisode): Promise<void>;
  /** F-05 timestamps: plays `episode` from `seconds`, seeking if it's already loaded. */
  playFrom(episode: PlayableEpisode, seconds: number): void;
  togglePlay(): void;
  seekTo(seconds: number): void;
  skipBack(): void;
  skipForward(): void;
  cycleRate(): void;
  playNext(episode: PlayableEpisode): void;
  playLast(episode: PlayableEpisode): void;
  removeFromQueue(episodeId: string): void;
  moveInQueue(episodeId: string, direction: -1 | 1): void;
  setPlayed(episodeId: string, played: boolean): void;
  /** Minutes from now, the end of the current episode, or null to turn the timer off. */
  setSleepTimer(option: number | 'endOfEpisode' | null): void;
};

const byKey = (a: QueueEntry, b: QueueEntry) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0);

type PersistedPlayerState = Pick<PlayerState, 'current' | 'rate' | 'skipBackSec' | 'skipForwardSec' | 'queue' | 'saved'>;

export const usePlayer = create<PlayerState>()(
  persist(
    (set, get) => {
      let lastSavedAt = 0;

      const save = (episodeId: string, patch: Partial<SavedState>) => {
        const prev = get().saved[episodeId] ?? { positionSec: 0, played: false, updatedAt: 0 };
        set({ saved: { ...get().saved, [episodeId]: { ...prev, ...patch, updatedAt: Date.now() } } });
      };

      const saveCurrentPosition = () => {
        const { current, positionSec, durationSec } = get();
        if (!current) return;
        lastSavedAt = Date.now();
        save(current.id, {
          positionSec,
          ...(shouldMarkPlayed(positionSec, durationSec ?? current.durationSec) && { played: true }),
        });
      };

      let sleepTick: ReturnType<typeof setInterval> | null = null;

      const stopSleepTimer = () => {
        if (sleepTick) clearInterval(sleepTick);
        sleepTick = null;
        audioPlayer.setVolume(1);
        set({ sleepTimer: null, sleepRemainingSec: null });
      };

      // Fades the last 10 s, and stops playback when a timed sleep timer runs out. End of
      // episode is handled by the 'ended' event instead.
      const tickSleepTimer = () => {
        const { sleepTimer, positionSec, durationSec, rate, playing } = get();
        if (!sleepTimer) return stopSleepTimer();
        const left = sleepTimerRemainingMs(sleepTimer, { now: Date.now(), positionSec, durationSec, rate });
        if (sleepTimer.kind === 'minutes' && left === 0) {
          if (playing) {
            audioPlayer.pause();
            set({ playing: false });
            saveCurrentPosition();
          }
          // After pausing, so restoring the volume can't blip.
          stopSleepTimer();
          return;
        }
        audioPlayer.setVolume(sleepFadeVolume(left));
        const seconds = left === null ? null : Math.ceil(left / 1000);
        if (get().sleepRemainingSec !== seconds) set({ sleepRemainingSec: seconds });
      };

      const advance = async () => {
        const [next, ...rest] = get().queue;
        if (!next) {
          set({ playing: false });
          return;
        }
        set({ queue: rest });
        await get().playEpisode(next);
      };

      audioPlayer.onEvent((event) => {
        switch (event.type) {
          case 'progress':
            set({
              positionSec: event.positionSec,
              durationSec: event.durationSec,
              playing: event.playing,
              buffering: event.buffering,
              error: null,
            });
            if (Date.now() - lastSavedAt >= POSITION_SAVE_INTERVAL_MS) saveCurrentPosition();
            break;
          case 'ended': {
            const { current, sleepTimer } = get();
            if (current) save(current.id, { positionSec: 0, played: true });
            if (sleepTimer?.kind === 'endOfEpisode') {
              // Stop here rather than starting the next episode.
              set({ playing: false });
              stopSleepTimer();
              break;
            }
            void advance();
            break;
          }
          case 'error':
            set({ error: event.message, playing: false, buffering: false });
            break;
          case 'remote':
            if (event.command === 'next') void advance();
            break;
        }
      });

      // Save the position when the app is backgrounded or the tab is hidden, since it may not come back.
      AppState.addEventListener('change', (state) => {
        if (state !== 'active' && get().loaded) saveCurrentPosition();
      });

      return {
        current: null,
        positionSec: 0,
        durationSec: null,
        playing: false,
        buffering: false,
        loaded: false,
        error: null,
        rate: 1,
        skipBackSec: 15,
        skipForwardSec: 30,
        queue: [],
        saved: {},
        sleepTimer: null,
        sleepRemainingSec: null,

        async playEpisode(episode) {
          if (get().current) saveCurrentPosition();
          const saved = get().saved[episode.id];
          // A finished episode starts over; otherwise resume where the listener left off.
          const startAt = saved && !saved.played ? saved.positionSec : 0;
          set({
            current: episode,
            positionSec: startAt,
            durationSec: episode.durationSec,
            buffering: true,
            loaded: false,
            error: null,
            queue: get().queue.filter((q) => q.id !== episode.id),
          });
          try {
            await audioPlayer.load(episode, startAt);
            set({ loaded: true });
            audioPlayer.setSkipIntervals(get().skipBackSec, get().skipForwardSec);
            audioPlayer.play();
          } catch (err) {
            set({ error: (err as Error).message, buffering: false });
          }
        },

        playFrom(episode, seconds) {
          const { current, loaded, playing } = get();
          if (current?.id === episode.id && loaded) {
            get().seekTo(seconds);
            if (!playing) audioPlayer.play();
            return;
          }
          // playEpisode resumes from the saved position, so start there.
          save(episode.id, { positionSec: seconds, played: false });
          void get().playEpisode(episode);
        },

        togglePlay() {
          const { current, loaded } = get();
          if (!current) return;
          if (!loaded) {
            void get().playEpisode(current);
          } else if (get().playing) {
            audioPlayer.pause();
            set({ playing: false });
            saveCurrentPosition();
          } else {
            audioPlayer.play();
          }
        },

        seekTo(seconds) {
          const duration = get().durationSec;
          const target = Math.max(0, duration ? Math.min(seconds, duration) : seconds);
          if (get().loaded) audioPlayer.seekTo(target);
          set({ positionSec: target });
          saveCurrentPosition();
        },

        skipBack() {
          get().seekTo(get().positionSec - get().skipBackSec);
        },

        skipForward() {
          get().seekTo(get().positionSec + get().skipForwardSec);
        },

        cycleRate() {
          const presets = RATE_PRESETS.filter((r) => r <= audioPlayer.maxRate);
          const next = presets.find((r) => r > get().rate) ?? presets[0] ?? 1;
          const rate = clampRate(next, audioPlayer.maxRate);
          audioPlayer.setRate(rate);
          set({ rate });
        },

        playNext(episode) {
          if (get().current?.id === episode.id) return;
          const queue = get().queue.filter((q) => q.id !== episode.id);
          set({ queue: [{ ...episode, sortKey: sortKeyBefore(queue[0]?.sortKey ?? null) }, ...queue] });
        },

        playLast(episode) {
          if (get().current?.id === episode.id) return;
          const queue = get().queue.filter((q) => q.id !== episode.id);
          set({ queue: [...queue, { ...episode, sortKey: sortKeyAfter(queue.at(-1)?.sortKey ?? null) }] });
        },

        removeFromQueue(episodeId) {
          set({ queue: get().queue.filter((q) => q.id !== episodeId) });
        },

        moveInQueue(episodeId, direction) {
          const queue = get().queue;
          const from = queue.findIndex((q) => q.id === episodeId);
          const to = from + direction;
          const item = queue[from];
          if (!item || to < 0 || to >= queue.length) return;

          // Only the moved item gets a new key, so the change syncs as one row.
          const rest = queue.filter((q) => q.id !== episodeId);
          const before = rest[to - 1]?.sortKey ?? null;
          const after = rest[to]?.sortKey ?? null;
          const moved = { ...item, sortKey: sortKeyBetween(before, after) };
          set({ queue: [...rest, moved].sort(byKey) });
        },

        setPlayed(episodeId, played) {
          save(episodeId, played ? { played: true, positionSec: 0 } : { played: false });
        },

        setSleepTimer(option) {
          if (option === null) return stopSleepTimer();
          set({
            sleepTimer:
              option === 'endOfEpisode'
                ? { kind: 'endOfEpisode' }
                : { kind: 'minutes', minutes: option, endsAt: Date.now() + option * 60_000 },
          });
          audioPlayer.setVolume(1);
          tickSleepTimer();
          sleepTick ??= setInterval(tickSleepTimer, 250);
        },
      };
    },
    {
      name: 'player',
      version: 1,
      storage: persistStorage<PersistedPlayerState>(),
      // The live position changes several times a second; it's restored from `saved` instead.
      partialize: ({ current, rate, skipBackSec, skipForwardSec, queue, saved }): PersistedPlayerState => ({
        current,
        rate,
        skipBackSec,
        skipForwardSec,
        queue,
        saved,
      }),
      merge: (persisted, state) => {
        const restored = { ...state, ...(persisted as PersistedPlayerState) };
        const saved = restored.current ? restored.saved[restored.current.id] : undefined;
        return {
          ...restored,
          positionSec: saved && !saved.played ? saved.positionSec : 0,
          durationSec: restored.current?.durationSec ?? null,
        };
      },
      onRehydrateStorage: () => (state) => {
        if (state) audioPlayer.setRate(clampRate(state.rate, audioPlayer.maxRate));
      },
    },
  ),
);
