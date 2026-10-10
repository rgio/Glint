import { NATIVE_MAX_RATE } from '@podcast/shared';
import { createAudioPlayer, setAudioModeAsync, type AudioStatus } from 'expo-audio';

import type { AudioPlayer, PlayableEpisode, PlayerEvent } from './types';

type ExpoPlayer = ReturnType<typeof createAudioPlayer>;

class NativeAudioPlayer implements AudioPlayer {
  readonly maxRate = NATIVE_MAX_RATE;
  private player: ExpoPlayer | null = null;
  private listeners = new Set<(event: PlayerEvent) => void>();
  private rate = 1;
  private modeSet: Promise<void> | null = null;
  private lockScreenActive = false;

  private emit(event: PlayerEvent) {
    for (const listener of this.listeners) listener(event);
  }

  private ensureAudioMode() {
    // doNotMix is required for lock screen controls; background playback needs
    // the expo-audio config plugin's enableBackgroundPlayback too (app.json).
    this.modeSet ??= setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix',
    });
    return this.modeSet;
  }

  prepare() {
    return this.ensureAudioMode().catch(() => {
      // Tried again on the first load.
      this.modeSet = null;
    });
  }

  private getPlayer(): ExpoPlayer {
    if (this.player) return this.player;
    const player = createAudioPlayer(null, { updateInterval: 500 });
    player.addListener('playbackStatusUpdate', (status: AudioStatus) => {
      if (status.error) this.emit({ type: 'error', message: status.error });
      if (status.didJustFinish) {
        this.emit({ type: 'ended' });
        return;
      }
      this.emit({
        type: 'progress',
        positionSec: status.currentTime,
        durationSec: status.duration > 0 ? status.duration : null,
        playing: status.playing,
        buffering: status.isBuffering,
      });
    });
    this.player = player;
    return player;
  }

  async load(episode: PlayableEpisode, startAtSec: number) {
    await this.ensureAudioMode();
    const player = this.getPlayer();
    player.replace({ uri: episode.url });
    player.setPlaybackRate(this.rate, 'high');
    const metadata = {
      title: episode.title,
      artist: episode.podcastTitle,
      albumTitle: episode.podcastTitle,
      artworkUrl: episode.artworkUrl ?? undefined,
    };
    // Android stops background audio after ~3 minutes unless lock screen controls are active.
    // Activate once; later episodes only change what the lock screen shows.
    if (this.lockScreenActive) {
      player.updateLockScreenMetadata(metadata);
    } else {
      player.setActiveForLockScreen(true, metadata, { showSeekBackward: true, showSeekForward: true });
      this.lockScreenActive = true;
    }
    if (startAtSec > 0) await player.seekTo(startAtSec);
  }

  play() {
    this.getPlayer().play();
  }

  pause() {
    this.player?.pause();
  }

  seekTo(seconds: number) {
    void this.player?.seekTo(seconds);
  }

  setRate(rate: number) {
    this.rate = Math.min(rate, this.maxRate);
    this.player?.setPlaybackRate(this.rate, 'high');
  }

  setVolume(volume: number) {
    if (this.player && Number.isFinite(volume)) this.player.volume = Math.min(1, Math.max(0, volume));
  }

  setSkipIntervals() {
    // The lock screen, headphones and notification skip 30 s, set in our expo-audio patch.
  }

  onEvent(listener: (event: PlayerEvent) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

const native = new NativeAudioPlayer();
// Set the audio session up at launch, so the first press of play doesn't wait for it.
void native.prepare();

export const audioPlayer: AudioPlayer = native;
