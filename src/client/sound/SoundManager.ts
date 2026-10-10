import { Howl } from "howler";
import { EventBus } from "../../core/EventBus";
import { UserSettings } from "../../core/game/UserSettings";
import {
  MusicTrack,
  musicTrackUrls,
  PlaySoundEffectEvent,
  SetBackgroundMusicVolumeEvent,
  SetSoundEffectsVolumeEvent,
  SoundEffect,
  soundEffectUrls,
} from "./Sounds";

export const MAX_CONCURRENT_SOUNDS = 8;

/** How long the war track keeps playing after the last battle ends. */
export const COMBAT_MUSIC_LINGER_MS = 10_000;
/** Crossfade duration between the theme and war tracks. */
export const MUSIC_CROSSFADE_MS = 1_500;

export interface SoundManagerOptions {
  /** Inherited sound effects; gated off in the license-safe local profile. */
  soundEffects: boolean;
  /** The user-supplied theme/war tracks under resources/local/music. */
  music: boolean;
}

interface MusicChannel {
  howl: Howl;
  playId: number | null;
}

export class SoundManager {
  private music: Map<MusicTrack, MusicChannel> = new Map();
  private activeTrack: MusicTrack = "theme";
  private musicStarted = false;
  private lastCombatAt: number | null = null;
  private soundEffects: Map<SoundEffect, Howl> = new Map();
  private soundEffectsVolume: number = 1;
  private backgroundMusicVolume: number = 0;
  private activeSounds: { howl: Howl; id: number }[] = [];
  private eventBus: EventBus;
  private onPlaySoundEffect: (e: PlaySoundEffectEvent) => void;
  private onSetBackgroundMusicVolume: (
    e: SetBackgroundMusicVolumeEvent,
  ) => void;
  private onSetSoundEffectsVolume: (e: SetSoundEffectsVolumeEvent) => void;
  private readonly soundEffectsEnabled: boolean;
  private readonly musicEnabled: boolean;

  constructor(
    eventBus: EventBus,
    userSettings: UserSettings,
    options: SoundManagerOptions = { soundEffects: true, music: true },
  ) {
    this.eventBus = eventBus;
    this.soundEffectsEnabled = options.soundEffects;
    this.musicEnabled = options.music;
    if (this.musicEnabled) {
      this.safely("initialize background music", () => {
        for (const [track, src] of musicTrackUrls) {
          this.music.set(track, {
            howl: new Howl({ src: [src], loop: true, volume: 0 }),
            playId: null,
          });
        }
      });
    }
    this.setBackgroundMusicVolume(userSettings.backgroundMusicVolume());
    this.setSoundEffectsVolume(userSettings.soundEffectsVolume());
    this.onPlaySoundEffect = (e) => this.playSoundEffect(e.effect);
    this.onSetBackgroundMusicVolume = (e) =>
      this.setBackgroundMusicVolume(e.volume);
    this.onSetSoundEffectsVolume = (e) => this.setSoundEffectsVolume(e.volume);
    eventBus.on(PlaySoundEffectEvent, this.onPlaySoundEffect);
    eventBus.on(SetBackgroundMusicVolumeEvent, this.onSetBackgroundMusicVolume);
    eventBus.on(SetSoundEffectsVolumeEvent, this.onSetSoundEffectsVolume);
  }

  public dispose(): void {
    this.eventBus.off(PlaySoundEffectEvent, this.onPlaySoundEffect);
    this.eventBus.off(
      SetBackgroundMusicVolumeEvent,
      this.onSetBackgroundMusicVolume,
    );
    this.eventBus.off(SetSoundEffectsVolumeEvent, this.onSetSoundEffectsVolume);
    this.music.forEach(({ howl }) => {
      this.safely("stop background track", () => howl.stop());
      this.safely("unload background track", () => howl.unload());
    });
    this.music.clear();
    this.musicStarted = false;
    this.soundEffects.forEach((sound) => {
      this.safely("stop sound effect", () => sound.stop());
      this.safely("unload sound effect", () => sound.unload());
    });
    this.soundEffects.clear();
    this.activeSounds = [];
  }

  private safely(action: string, fn: () => void): void {
    try {
      fn();
    } catch (err) {
      console.error(`SoundManager: failed to ${action}`, err);
    }
  }

  /** Which track is currently (or is fading) in the foreground. */
  public currentMusicTrack(): MusicTrack {
    return this.activeTrack;
  }

  public playBackgroundMusic(): void {
    this.safely("play background music", () => {
      const channel = this.music.get(this.activeTrack);
      if (!channel) return;
      this.musicStarted = true;
      this.resume(channel, this.backgroundMusicVolume);
    });
  }

  public stopBackgroundMusic(): void {
    this.safely("stop background music", () => {
      this.musicStarted = false;
      this.music.forEach((channel) => {
        if (channel.playId !== null) channel.howl.stop(channel.playId);
        channel.playId = null;
      });
    });
  }

  /**
   * Called once per game tick with whether the local player is at war.
   * The war track starts as soon as a battle begins and lingers for
   * COMBAT_MUSIC_LINGER_MS after the last one ends so brief lulls between
   * waves do not flip the music back and forth.
   */
  public reportCombat(inCombat: boolean, now: number = Date.now()): void {
    if (inCombat) this.lastCombatAt = now;
    const wantWar =
      this.lastCombatAt !== null &&
      now - this.lastCombatAt < COMBAT_MUSIC_LINGER_MS;
    this.switchTrack(wantWar ? "war" : "theme");
  }

  private switchTrack(track: MusicTrack): void {
    if (track === this.activeTrack) return;
    const previous = this.activeTrack;
    this.activeTrack = track;
    if (!this.musicStarted) return;
    this.safely(`crossfade music to ${track}`, () => {
      const from = this.music.get(previous);
      const to = this.music.get(track);
      if (from && from.playId !== null) {
        const id = from.playId;
        from.howl.fade(this.backgroundMusicVolume, 0, MUSIC_CROSSFADE_MS, id);
        from.howl.once(
          "fade",
          () => {
            // Only park the track if it is still in the background; a quick
            // switch back would otherwise pause the track we just resumed.
            if (this.activeTrack !== previous) from.howl.pause(id);
          },
          id,
        );
      }
      if (to) {
        this.resume(to, 0);
        if (to.playId !== null) {
          to.howl.fade(
            0,
            this.backgroundMusicVolume,
            MUSIC_CROSSFADE_MS,
            to.playId,
          );
        }
      }
    });
  }

  private resume(channel: MusicChannel, volume: number): void {
    if (channel.playId === null) {
      channel.playId = channel.howl.play();
    } else if (!channel.howl.playing(channel.playId)) {
      channel.howl.play(channel.playId);
    }
    if (channel.playId !== null) {
      channel.howl.volume(volume, channel.playId);
    }
  }

  // Slider positions are linear (0–1) but perceived loudness is roughly
  // logarithmic, so feeding the position straight to Howler makes the top of
  // the range sound identical. Square the position for an audio-taper curve.
  private perceptualGain(position: number): number {
    const clamped = Math.max(0, Math.min(1, position));
    return clamped * clamped;
  }

  public setBackgroundMusicVolume(volume: number): void {
    this.backgroundMusicVolume = this.perceptualGain(volume);
    this.safely("set background music volume", () => {
      this.music.forEach((channel, track) => {
        const target =
          track === this.activeTrack ? this.backgroundMusicVolume : 0;
        if (channel.playId !== null) {
          channel.howl.volume(target, channel.playId);
        } else {
          channel.howl.volume(target);
        }
      });
    });
  }

  private getOrLoadSoundEffect(name: SoundEffect): Howl | null {
    if (!this.soundEffectsEnabled) return null;
    let sound = this.soundEffects.get(name);
    if (sound) return sound;
    const src = soundEffectUrls.get(name);
    if (!src) return null;
    try {
      sound = new Howl({ src: [src], volume: this.soundEffectsVolume });
      this.soundEffects.set(name, sound);
      return sound;
    } catch (err) {
      console.error(`SoundManager: failed to load sound ${name}`, err);
      return null;
    }
  }

  private removeActiveSoundById(id: number): void {
    this.activeSounds = this.activeSounds.filter((s) => s.id !== id);
  }

  public playSoundEffect(name: SoundEffect): void {
    if (!this.soundEffectsEnabled) return;
    this.safely(`play sound ${name}`, () => {
      const howl = this.getOrLoadSoundEffect(name);
      if (!howl) return;

      if (this.activeSounds.length >= MAX_CONCURRENT_SOUNDS) {
        const oldest = this.activeSounds[0];
        oldest.howl.stop(oldest.id);
        this.removeActiveSoundById(oldest.id);
      }

      const id = howl.play();
      this.activeSounds.push({ howl, id });
      howl.once("end", () => this.removeActiveSoundById(id), id);
      howl.once("stop", () => this.removeActiveSoundById(id), id);
    });
  }

  public setSoundEffectsVolume(volume: number): void {
    this.soundEffectsVolume = this.perceptualGain(volume);
    this.safely("set sound effects volume", () => {
      this.soundEffects.forEach((sound) => {
        sound.volume(this.soundEffectsVolume);
      });
    });
  }

  public stopSoundEffect(name: SoundEffect): void {
    this.safely(`stop sound ${name}`, () => {
      const howl = this.soundEffects.get(name);
      if (howl) {
        howl.stop();
        this.activeSounds = this.activeSounds.filter((s) => s.howl !== howl);
      }
    });
  }
}
