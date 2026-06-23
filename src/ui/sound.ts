// Chiptune SFX — the Tamagotchi/Cybiko beeps and boops. Pure Web Audio (no
// deps): short square-wave tones with a quick decay envelope. The AudioContext
// is created lazily on the first sound, which always follows a user gesture
// (button/key), satisfying browser autoplay policy.

type Wave = OscillatorType;

let ctx: AudioContext | null = null;
let muted = false;

export function setMuted(m: boolean): void {
  muted = m;
}
export function isMuted(): boolean {
  return muted;
}

function audio(): AudioContext | null {
  try {
    if (!ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new AC();
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

// One beep: freq Hz, starting `at` seconds from now, lasting `dur`.
function beep(c: AudioContext, freq: number, at: number, dur: number, wave: Wave = "square", gain = 0.05): void {
  const t0 = c.currentTime + at;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = wave;
  osc.frequency.setValueAtTime(freq, t0);
  osc.connect(g);
  g.connect(c.destination);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

export type Sfx =
  | "select" | "accept" | "cancel" | "feed" | "evolve"
  | "type" | "error" | "connect";

export function sfx(name: Sfx): void {
  if (muted) return;
  const c = audio();
  if (!c) return;
  switch (name) {
    case "select": // a crisp blip
      beep(c, 880, 0, 0.04);
      break;
    case "accept": // two-note up chirp
      beep(c, 660, 0, 0.05);
      beep(c, 988, 0.055, 0.07);
      break;
    case "cancel": // two-note down boop
      beep(c, 520, 0, 0.05);
      beep(c, 330, 0.05, 0.08);
      break;
    case "feed": // cute up bloop
      beep(c, 587, 0, 0.05);
      beep(c, 784, 0.05, 0.06);
      break;
    case "evolve": // a little ascending fanfare
      [523, 659, 784, 1047].forEach((f, i) => beep(c, f, i * 0.09, 0.12, "square", 0.06));
      break;
    case "type": // tiny key tick
      beep(c, 1500, 0, 0.015, "square", 0.03);
      break;
    case "connect": // bright two-note
      beep(c, 659, 0, 0.06);
      beep(c, 988, 0.07, 0.1, "square", 0.06);
      break;
    case "error": // low buzz
      beep(c, 160, 0, 0.22, "sawtooth", 0.05);
      break;
  }
}
