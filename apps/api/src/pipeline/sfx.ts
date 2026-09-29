import type { SfxId } from '@edu/shared';
import { samplesToWav } from './audio.js';

/**
 * Hiệu ứng âm thanh tổng hợp bằng code (sóng sin, nhiễu, đường bao), không dùng file của bên thứ ba
 * nên không vướng bản quyền. Người dùng có thể thay từng hiệu ứng bằng file riêng trong Thư viện.
 * Tăng SFX_VERSION khi đổi công thức để tạo lại file.
 */
export const SFX_VERSION = 1;
const RATE = 44100;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

type Buf = Float32Array;
const make = (sec: number): Buf => new Float32Array(Math.round(sec * RATE));

/** Nốt kiểu chuông: vài họa âm tắt dần theo hàm mũ */
function bell(out: Buf, at: number, freq: number, dur: number, gain: number, partials = [1, 2.01, 3.02, 4.2]) {
  const start = Math.round(at * RATE);
  const n = Math.round(dur * RATE);
  partials.forEach((m, k) => {
    const amp = gain / (k + 1) ** 1.4;
    const decay = 3.2 + k * 2.4;
    for (let i = 0; i < n && start + i < out.length; i++) {
      const t = i / RATE;
      const attack = Math.min(1, t / 0.004);
      out[start + i] += amp * attack * Math.exp(-decay * t / dur) * Math.sin(2 * Math.PI * freq * m * t);
    }
  });
}

/** Sóng sin quét tần số (glide) */
function sweep(out: Buf, at: number, f0: number, f1: number, dur: number, gain: number, curve = 2) {
  const start = Math.round(at * RATE);
  const n = Math.round(dur * RATE);
  let phase = 0;
  for (let i = 0; i < n && start + i < out.length; i++) {
    const p = i / n;
    const f = f0 + (f1 - f0) * (1 - (1 - p) ** curve);
    phase += (2 * Math.PI * f) / RATE;
    const env = Math.min(1, i / (0.003 * RATE)) * (1 - p) ** 1.6;
    out[start + i] += gain * env * Math.sin(phase);
  }
}

/** Nhiễu lọc thông dải với tâm lọc thay đổi theo thời gian (tiếng gió "vút") */
function noiseSweep(out: Buf, at: number, dur: number, gain: number, fc: (p: number) => number, env: (p: number) => number, seed = 7) {
  const r = rng(seed);
  const start = Math.round(at * RATE);
  const n = Math.round(dur * RATE);
  // Bộ lọc state-variable
  let low = 0;
  let band = 0;
  for (let i = 0; i < n && start + i < out.length; i++) {
    const p = i / n;
    const f = 2 * Math.sin((Math.PI * fc(p)) / RATE);
    const q = 0.35;
    const x = r() * 2 - 1;
    low += f * band;
    const high = x - low - q * band;
    band += f * high;
    out[start + i] += gain * env(p) * band;
  }
}

function normalize(buf: Buf, peak = 0.85): Int16Array {
  let max = 0;
  for (const v of buf) max = Math.max(max, Math.abs(v));
  const k = max > 0 ? peak / max : 0;
  const out = new Int16Array(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = Math.round(Math.max(-1, Math.min(1, buf[i] * k)) * 32767);
  return out;
}

const RECIPES: Record<SfxId, () => Buf> = {
  pop: () => {
    const b = make(0.16);
    sweep(b, 0, 950, 260, 0.09, 1, 1.4);
    noiseSweep(b, 0, 0.012, 0.35, () => 3000, (p) => 1 - p, 3);
    return b;
  },
  ding: () => {
    const b = make(1.1);
    bell(b, 0, 1318.5, 1.1, 1);
    return b;
  },
  chime: () => {
    const b = make(1.2);
    [1046.5, 1318.5, 1568].forEach((f, i) => bell(b, i * 0.11, f, 1.2 - i * 0.11, 0.8));
    return b;
  },
  sparkle: () => {
    const b = make(0.9);
    const r = rng(11);
    for (let i = 0; i < 14; i++) {
      const at = i * 0.045 + r() * 0.02;
      bell(b, at, 2200 + r() * 2600, 0.25, 0.35 * (1 - i / 16), [1, 2.7]);
    }
    return b;
  },
  whoosh: () => {
    const b = make(0.55);
    noiseSweep(b, 0, 0.55, 1, (p) => 350 + 2400 * Math.sin(Math.PI * p) ** 1.5, (p) => Math.sin(Math.PI * p) ** 2, 5);
    return b;
  },
  swish: () => {
    const b = make(0.28);
    noiseSweep(b, 0, 0.28, 1, (p) => 800 + 3500 * p, (p) => Math.sin(Math.PI * p) ** 1.5, 9);
    return b;
  },
  boing: () => {
    const b = make(0.6);
    let phase = 0;
    for (let i = 0; i < b.length; i++) {
      const t = i / RATE;
      const f = 190 + 120 * Math.exp(-t * 6) * Math.sin(2 * Math.PI * 11 * t) + 60 * Math.exp(-t * 4);
      phase += (2 * Math.PI * f) / RATE;
      b[i] = Math.min(1, t / 0.005) * Math.exp(-t * 4.2) * Math.sin(phase);
    }
    return b;
  },
  click: () => {
    const b = make(0.06);
    noiseSweep(b, 0, 0.006, 0.8, () => 4500, (p) => 1 - p, 13);
    sweep(b, 0, 3200, 2400, 0.03, 0.5, 1);
    return b;
  },
  tada: () => {
    const b = make(1.6);
    const chord = [523.25, 659.25, 783.99, 1046.5];
    const brass = [1, 2, 3, 4, 5];
    chord.forEach((f) => bell(b, 0, f, 0.18, 0.35, brass));
    chord.forEach((f) => bell(b, 0.2, f, 1.4, 0.45, brass));
    return b;
  },
  bubble: () => {
    const b = make(0.5);
    [0, 0.12, 0.22].forEach((at, i) => sweep(b, at, 400 + i * 140, 1100 + i * 200, 0.08, 0.8, 0.6));
    return b;
  },
};

export function synthesizeSfx(id: SfxId): Buffer {
  return samplesToWav(normalize(RECIPES[id]()), RATE);
}
