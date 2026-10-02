import { MAX_RATE } from '@podcast/shared';

import type { AudioPlayer, PlayableEpisode, PlayerEvent } from './types';

class WebAudioPlayer implements AudioPlayer {
  readonly maxRate = MAX_RATE;
  private audio: HTMLAudioElement | null = null;
  private listeners = new Set<(event: PlayerEvent) => void>();
  private rate = 1;
  private skipBackSec = 15;
  private skipForwardSec = 30;

  private emit(event: PlayerEvent) {
    for (const listener of this.listeners) listener(event);
  }

  private emitProgress = () => {
    const a = this.audio;
    if (!a) return;
    this.emit({
      type: 'progress',
      positionSec: a.currentTime,
      durationSec: Number.isFinite(a.duration) ? a.duration : null,
      playing: !a.paused,
      buffering: a.readyState < HTMLMediaElement.HAVE_FUTURE_DATA && !a.paused,
    });
    this.updatePositionState();
  };

  private getAudio(): HTMLAudioElement {
    if (this.audio) return this.audio;
    const a = new Audio();
    a.preload = 'auto';
    for (const name of ['timeupdate', 'play', 'pause', 'waiting', 'playing', 'durationchange', 'seeked']) {
      a.addEventListener(name, this.emitProgress);
    }
    a.addEventListener('ended', () => this.emit({ type: 'ended' }));
    a.addEventListener('error', () =>
      this.emit({ type: 'error', message: a.error?.message || 'This episode could not be played.' }),
    );
    this.registerMediaSession();
    this.audio = a;
    return a;
  }

  /** Lock screen, keyboard media keys and headphone controls in supporting browsers. */
  private registerMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const session = navigator.mediaSession;
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['play', () => this.play()],
      ['pause', () => this.pause()],
      ['seekbackward', (d) => this.seekBy(-(d.seekOffset ?? this.skipBackSec))],
      ['seekforward', (d) => this.seekBy(d.seekOffset ?? this.skipForwardSec)],
      ['seekto', (d) => d.seekTime != null && this.seekTo(d.seekTime)],
      ['nexttrack', () => this.emit({ type: 'remote', command: 'next' })],
    ];
    for (const [action, handler] of handlers) {
      try {
        session.setActionHandler(action, handler);
      } catch {
        // The browser does not support this action.
      }
    }
  }

  private updatePositionState() {
    const a = this.audio;
    if (!a || !('mediaSession' in navigator) || !Number.isFinite(a.duration)) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: a.duration,
        position: Math.min(a.currentTime, a.duration),
        playbackRate: a.playbackRate,
      });
    } catch {
      // Ignore browsers that reject position state.
    }
  }

  private seekBy(delta: number) {
    const a = this.audio;
    if (a) this.seekTo(Math.max(0, a.currentTime + delta));
  }

  async load(episode: PlayableEpisode, startAtSec: number) {
    const a = this.getAudio();
    a.src = episode.url;
    a.playbackRate = this.rate;
    // Keep the pitch natural at higher speeds.
    a.preservesPitch = true;
    if (startAtSec > 0) {
      a.addEventListener('loadedmetadata', () => (a.currentTime = startAtSec), { once: true });
    }
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: episode.title,
        artist: episode.podcastTitle,
        album: episode.podcastTitle,
        artwork: episode.artworkUrl ? [{ src: episode.artworkUrl, sizes: '512x512' }] : [],
      });
    }
  }

  play() {
    this.getAudio()
      .play()
      .catch((err: Error) => {
        // Autoplay rules can block play() until the user interacts with the page.
        if (err.name !== 'AbortError') this.emit({ type: 'error', message: err.message });
      });
  }

  pause() {
    this.audio?.pause();
  }

  seekTo(seconds: number) {
    if (this.audio) this.audio.currentTime = seconds;
  }

  setRate(rate: number) {
    this.rate = Math.min(rate, this.maxRate);
    if (this.audio) this.audio.playbackRate = this.rate;
  }

  setSkipIntervals(backSec: number, forwardSec: number) {
    this.skipBackSec = backSec;
    this.skipForwardSec = forwardSec;
  }

  onEvent(listener: (event: PlayerEvent) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export const audioPlayer: AudioPlayer = new WebAudioPlayer();
