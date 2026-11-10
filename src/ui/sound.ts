export type SoundKind = "move" | "capture" | "check" | "end";

const STORAGE_KEY = "fable_5-2_20261110:sound";

/** Small synthesised sound effects. Nothing is loaded; every sound is built from oscillators and noise. */
export class Sound {
  enabled: boolean;
  private context: AudioContext | null = null;

  constructor() {
    this.enabled = Sound.readPreference();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    try {
      localStorage.setItem(STORAGE_KEY, enabled ? "on" : "off");
    } catch {
      // Storage can be blocked (private mode, sandboxed frame). The preference then lasts for this visit only.
    }
  }

  play(kind: SoundKind): void {
    if (!this.enabled) {
      return;
    }
    const context = this.ensureContext();
    if (context === null) {
      return;
    }
    const now = context.currentTime;
    if (kind === "move") {
      this.knock(context, now, 0.5);
    } else if (kind === "capture") {
      this.knock(context, now, 0.8);
      this.knock(context, now + 0.06, 0.55);
    } else if (kind === "check") {
      this.tone(context, now, 620, 0.09, 0.14);
      this.tone(context, now + 0.1, 830, 0.14, 0.14);
    } else {
      [392, 494, 587].forEach((frequency, index) => this.tone(context, now + index * 0.13, frequency, 0.3, 0.12));
    }
  }

  private static readPreference(): boolean {
    try {
      return localStorage.getItem(STORAGE_KEY) !== "off";
    } catch {
      return true;
    }
  }

  private ensureContext(): AudioContext | null {
    if (this.context === null) {
      if (typeof AudioContext === "undefined") {
        return null;
      }
      this.context = new AudioContext();
    }
    if (this.context.state === "suspended") {
      // Browsers keep audio suspended until a user gesture; a refusal only means this sound is skipped.
      void this.context.resume().catch((): void => {});
    }
    return this.context;
  }

  /** A piece set down on wood: a short filtered noise burst over a low thump. */
  private knock(context: AudioContext, start: number, volume: number): void {
    const length = Math.floor(context.sampleRate * 0.05);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) {
      samples[index] = (Math.random() * 2 - 1) * (1 - index / length) ** 2;
    }
    const noise = context.createBufferSource();
    noise.buffer = buffer;
    const filter = context.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 1500;
    filter.Q.value = 0.9;
    const gain = context.createGain();
    gain.gain.value = volume * 0.5;
    noise.connect(filter).connect(gain).connect(context.destination);
    noise.start(start);
    this.tone(context, start, 150, 0.07, volume * 0.3);
  }

  private tone(context: AudioContext, start: number, frequency: number, duration: number, volume: number): void {
    const oscillator = context.createOscillator();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    const gain = context.createGain();
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }
}
