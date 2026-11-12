/**
 * Short cues for a state change. Synthesized here: no sample files.
 * One sound per event, never a loop.
 */
export interface Cues {
  accept(): void;
  refuse(): void;
  shot(): void;
  built(): void;
}

export function createCues(): Cues {
  let ctx: AudioContext | null = null;

  function context(): AudioContext | null {
    const Ctx = window.AudioContext;
    if (!Ctx) return null;
    ctx ??= new Ctx();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  }

  function tone(freq: number, seconds: number, type: OscillatorType, level: number): void {
    const audio = context();
    if (!audio) return;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(level, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + seconds);
    osc.connect(gain);
    gain.connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + seconds);
  }

  return {
    accept() {
      tone(620, 0.05, 'square', 0.03);
    },
    refuse() {
      tone(140, 0.12, 'sawtooth', 0.04);
    },
    shot() {
      tone(180, 0.04, 'square', 0.035);
    },
    built() {
      tone(440, 0.08, 'triangle', 0.04);
      tone(660, 0.12, 'triangle', 0.03);
    },
  };
}
