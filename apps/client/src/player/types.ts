/** What the player needs to know about an episode to play it and show it on the lock screen. */
export type PlayableEpisode = {
  id: string;
  podcastId: string;
  title: string;
  podcastTitle: string;
  url: string;
  artworkUrl: string | null;
  durationSec: number | null;
};

export type PlayerEvent =
  | { type: 'progress'; positionSec: number; durationSec: number | null; playing: boolean; buffering: boolean }
  | { type: 'ended' }
  | { type: 'error'; message: string }
  /** Lock screen, headphone or Media Session commands that the store should handle. */
  | { type: 'remote'; command: 'next' | 'previous' };

/**
 * Platform audio engine. Screens never use this directly; they go through the
 * player store. Implementations: audio-player.native.ts (expo-audio) and
 * audio-player.web.ts (HTML5 audio + Media Session API).
 */
export interface AudioPlayer {
  /** Highest playback rate this platform supports. */
  readonly maxRate: number;
  load(episode: PlayableEpisode, startAtSec: number): Promise<void>;
  play(): void;
  pause(): void;
  seekTo(seconds: number): void;
  setRate(rate: number): void;
  setSkipIntervals(backSec: number, forwardSec: number): void;
  onEvent(listener: (event: PlayerEvent) => void): () => void;
}
