import { useSyncExternalStore } from 'react';

// Browser sound for simulated passive buzzers. The simulator reports each buzzer's pitch changes
// in virtual time; they are replayed through Web Audio a short moment later so melodies keep their
// timing even though the UI only polls a few times per second.
export type BuzzerWave = 'square' | 'sine' | 'triangle' | 'sawtooth';
export interface BuzzerSettings {
  muted: boolean;
  volume: number; // 0–1
  wave: BuzzerWave;
  semitones: number; // pitch shift applied on top of the firmware frequency
}
export const BUZZER_WAVES: { id: BuzzerWave; label: string }[] = [
  { id: 'square', label: '方波（接近壓電蜂鳴器）' },
  { id: 'sine', label: '正弦波（柔和）' },
  { id: 'triangle', label: '三角波' },
  { id: 'sawtooth', label: '鋸齒波' },
];
export const BUZZER_SEMITONE_RANGE = 24;
// Notes play this long after they happened in the simulation. It only has to cover the state
// poll interval (100 ms while a buzzer simulates) plus a little jitter; a note that arrives later
// than this is played at once, so the cost of a late poll is timing, not a lost note.
const LOOKAHEAD_S = 0.25;
const STORAGE_KEY = 'opencircuit_buzzer_audio';
const defaults: BuzzerSettings = { muted: false, volume: 0.3, wave: 'square', semitones: 0 };

export interface BuzzerState {
  frequency: number;
  count: number;
  timeNs: number;
  notes: { n: number; atNs: number; frequency: number }[];
}

const clamp = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
function load(): BuzzerSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    return {
      muted: saved.muted === true,
      volume: clamp(saved.volume, 0, 1, defaults.volume),
      wave: BUZZER_WAVES.some((w) => w.id === saved.wave) ? saved.wave : defaults.wave,
      semitones: Math.round(
        clamp(saved.semitones, -BUZZER_SEMITONE_RANGE, BUZZER_SEMITONE_RANGE, 0),
      ),
    };
  } catch {
    return { ...defaults };
  }
}

class Voice {
  readonly osc: OscillatorNode;
  readonly gate: GainNode;
  lastCount = -1;
  constructor(
    private readonly context: AudioContext,
    master: AudioNode,
    wave: BuzzerWave,
    cents: number,
  ) {
    this.osc = context.createOscillator();
    this.gate = context.createGain();
    this.osc.type = wave;
    this.osc.detune.value = cents;
    this.osc.frequency.value = 440;
    this.gate.gain.value = 0;
    this.osc.connect(this.gate).connect(master);
    this.osc.start();
  }
  silence() {
    const now = this.context.currentTime;
    this.gate.gain.cancelScheduledValues(now);
    this.gate.gain.setTargetAtTime(0, now, 0.01);
  }
  dispose() {
    this.silence();
    window.setTimeout(() => this.osc.stop(), 100);
  }
}

class BuzzerAudio {
  private settings = load();
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private voices = new Map<string, Voice>();
  private test: Voice | null = null;
  private listeners = new Set<() => void>();
  private snapshot = this.makeSnapshot();
  private armed = false;
  private makeSnapshot() {
    return {
      ...this.settings,
      blocked: !!this.context && this.context.state !== 'running',
      testing: !!this.test,
    };
  }
  private emit() {
    const next = this.makeSnapshot(),
      previous = this.snapshot as Record<string, unknown>;
    if (Object.entries(next).every(([key, value]) => previous[key] === value)) return;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = () => this.snapshot;
  // Browsers only allow sound after a user gesture, so the first click or key press resumes it.
  arm() {
    if (this.armed || typeof window === 'undefined') return;
    this.armed = true;
    const unlock = () => {
      void this.ensure()
        ?.resume()
        .then(() => this.emit());
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
    };
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
  }
  private ensure() {
    if (this.context) return this.context;
    const Context = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!Context) return null;
    this.context = new Context() as AudioContext;
    this.master = this.context.createGain();
    this.master.gain.value = this.settings.muted ? 0 : this.settings.volume;
    this.master.connect(this.context.destination);
    this.context.onstatechange = () => this.emit();
    return this.context;
  }
  private voice(id: string) {
    const context = this.ensure();
    if (!context || !this.master) return null;
    let voice = this.voices.get(id);
    if (!voice) {
      voice = new Voice(context, this.master, this.settings.wave, this.settings.semitones * 100);
      this.voices.set(id, voice);
    }
    return voice;
  }
  update(patch: Partial<BuzzerSettings>) {
    const next = { ...this.settings, ...patch };
    this.settings = {
      muted: !!next.muted,
      volume: clamp(next.volume, 0, 1, defaults.volume),
      wave: BUZZER_WAVES.some((w) => w.id === next.wave) ? next.wave : defaults.wave,
      semitones: Math.round(
        clamp(next.semitones, -BUZZER_SEMITONE_RANGE, BUZZER_SEMITONE_RANGE, 0),
      ),
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      // Private windows may refuse storage; the settings still apply to this page.
    }
    if (this.context && this.master) {
      const now = this.context.currentTime;
      this.master.gain.setTargetAtTime(this.settings.muted ? 0 : this.settings.volume, now, 0.015);
      for (const voice of [...this.voices.values(), ...(this.test ? [this.test] : [])]) {
        voice.osc.type = this.settings.wave;
        voice.osc.detune.setTargetAtTime(this.settings.semitones * 100, now, 0.015);
      }
    }
    this.emit();
  }
  // Called with every simulator state poll.
  feed(simulation: any) {
    const buzzers = Object.entries<any>(simulation?.peripherals ?? {}).filter(
      ([, device]) => device?.kind === 'buzzer',
    );
    if (!buzzers.length && !this.voices.size) return;
    this.arm();
    const live = !!simulation?.running && !simulation.paused;
    const speed = Math.max(1, Number(simulation?.speed) || 1);
    for (const [id, state] of buzzers as [string, BuzzerState][]) {
      const voice = this.voice(id);
      if (!voice || !this.context) continue;
      if (!live) {
        voice.silence();
        voice.lastCount = state.count;
        continue;
      }
      // A first sighting joins mid-stream: replaying the whole log would play it as one burst.
      if (voice.lastCount < 0) voice.lastCount = Math.max(0, state.count - 1);
      if (state.count < voice.lastCount) voice.lastCount = 0; // simulation was restarted
      const now = this.context.currentTime;
      const fresh = state.notes.filter((note) => note.n > voice.lastCount);
      for (const note of fresh) {
        const at = Math.max(now, now + LOOKAHEAD_S + (note.atNs - state.timeNs) / 1e9 / speed);
        if (note.frequency > 0) {
          voice.osc.frequency.setValueAtTime(note.frequency, at);
          voice.gate.gain.setTargetAtTime(1, at, 0.003);
        } else voice.gate.gain.setTargetAtTime(0, at, 0.005);
      }
      voice.lastCount = state.count;
    }
    for (const [id, voice] of this.voices)
      if (!buzzers.some(([key]) => key === id)) {
        voice.dispose();
        this.voices.delete(id);
      }
    this.emit();
  }
  silenceAll() {
    for (const voice of this.voices.values()) voice.silence();
  }
  // Plays a steady tone through the same chain so volume, wave and pitch shift can be judged.
  testTone(frequency: number | null) {
    this.test?.dispose();
    this.test = null;
    if (frequency !== null) {
      const context = this.ensure();
      if (context && this.master) {
        void context.resume();
        this.test = new Voice(
          context,
          this.master,
          this.settings.wave,
          this.settings.semitones * 100,
        );
        this.test.osc.frequency.value = clamp(frequency, 20, 20000, 440);
        this.test.gate.gain.setTargetAtTime(1, context.currentTime, 0.005);
      }
    }
    this.emit();
  }
  setTestFrequency(frequency: number) {
    if (this.test && this.context)
      this.test.osc.frequency.setTargetAtTime(
        clamp(frequency, 20, 20000, 440),
        this.context.currentTime,
        0.01,
      );
  }
  resume() {
    void this.ensure()
      ?.resume()
      .then(() => this.emit());
  }
}

export const buzzerAudio = new BuzzerAudio();
export const useBuzzerAudio = () =>
  useSyncExternalStore(buzzerAudio.subscribe, buzzerAudio.getSnapshot);
