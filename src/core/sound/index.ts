/**
 * Interface sounds.
 *
 * Tones are synthesised with the Web Audio API rather than shipped as audio
 * files — a handful of short blips would otherwise be most of the bundle.
 *
 * Browsers require a user gesture before audio may start, so the context is
 * created lazily on the first sound and resumed if it was suspended.
 */

import { getSettings } from '../settings/store';

type SoundName = 'click' | 'open' | 'close' | 'notify' | 'error' | 'trash';

interface Tone {
  frequency: number;
  duration: number;
  type: OscillatorType;
  /** Peak gain before the volume setting is applied. */
  gain: number;
  /** Optional second tone, played after the first. */
  then?: Omit<Tone, 'then'>;
}

const TONES: Record<SoundName, Tone> = {
  click: { frequency: 620, duration: 0.035, type: 'sine', gain: 0.05 },
  open: { frequency: 520, duration: 0.07, type: 'sine', gain: 0.06, then: { frequency: 780, duration: 0.07, type: 'sine', gain: 0.05 } },
  close: { frequency: 640, duration: 0.06, type: 'sine', gain: 0.05, then: { frequency: 420, duration: 0.07, type: 'sine', gain: 0.045 } },
  notify: { frequency: 880, duration: 0.09, type: 'sine', gain: 0.07, then: { frequency: 1170, duration: 0.11, type: 'sine', gain: 0.06 } },
  error: { frequency: 220, duration: 0.11, type: 'triangle', gain: 0.08, then: { frequency: 165, duration: 0.14, type: 'triangle', gain: 0.07 } },
  trash: { frequency: 340, duration: 0.05, type: 'triangle', gain: 0.05, then: { frequency: 240, duration: 0.09, type: 'triangle', gain: 0.045 } },
};

let context: AudioContext | null = null;

function ensureContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!context) {
    try {
      context = new Ctor();
    } catch {
      return null;
    }
  }
  if (context.state === 'suspended') void context.resume().catch(() => undefined);
  return context;
}

function playTone(ctx: AudioContext, tone: Tone, startAt: number, volume: number) {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = tone.type;
  oscillator.frequency.setValueAtTime(tone.frequency, startAt);

  const peak = Math.max(0.0001, tone.gain * volume);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(peak, startAt + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + tone.duration);

  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + tone.duration + 0.02);
}

export function playSound(name: SoundName): void {
  const settings = getSettings();
  if (!settings.uiSounds || settings.muted || settings.volume === 0) return;

  const ctx = ensureContext();
  if (!ctx) return;

  const volume = settings.volume / 100;
  const tone = TONES[name];
  const now = ctx.currentTime;

  try {
    playTone(ctx, tone, now, volume);
    if (tone.then) playTone(ctx, { ...tone.then }, now + tone.duration * 0.8, volume);
  } catch {
    /* audio is a nicety; never let it break an interaction */
  }
}

/** Release the audio context, e.g. on OS reset. */
export function disposeSound(): void {
  void context?.close().catch(() => undefined);
  context = null;
}
