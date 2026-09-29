/** Đọc WAV PCM 16-bit và tính khẩu hình (miệng mở/khép) theo từng frame video. */

export interface WavInfo {
  sampleRate: number;
  channels: number;
  samples: Int16Array; // đã trộn về mono
}

export function parseWav(buf: Buffer): WavInfo {
  if (buf.subarray(0, 4).toString('ascii') !== 'RIFF') throw new Error('Không phải file WAV');
  let offset = 12;
  let sampleRate = 24000;
  let channels = 1;
  let bits = 16;
  while (offset + 8 <= buf.length) {
    const id = buf.subarray(offset, offset + 4).toString('ascii');
    let size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      channels = buf.readUInt16LE(body + 2);
      sampleRate = buf.readUInt32LE(body + 4);
      bits = buf.readUInt16LE(body + 14);
    } else if (id === 'data') {
      if (bits !== 16) throw new Error(`WAV ${bits}-bit chưa được hỗ trợ`);
      // Một số encoder ghi kích thước 0/0xFFFFFFFF khi stream
      if (size === 0 || body + size > buf.length) size = buf.length - body;
      const frames = Math.floor(size / (2 * channels));
      const samples = new Int16Array(frames);
      for (let i = 0; i < frames; i++) {
        let sum = 0;
        for (let c = 0; c < channels; c++) sum += buf.readInt16LE(body + (i * channels + c) * 2);
        samples[i] = Math.round(sum / channels);
      }
      return { sampleRate, channels, samples };
    }
    offset = body + size + (size % 2);
  }
  throw new Error('WAV không có dữ liệu âm thanh');
}

export function analyzeSpeech(buf: Buffer, fps: number) {
  const { sampleRate, samples } = parseWav(buf);
  const durationMs = Math.round((samples.length / sampleRate) * 1000);
  const perFrame = sampleRate / fps;
  const frames = Math.ceil(samples.length / perFrame);
  const rms = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    const start = Math.floor(f * perFrame);
    const end = Math.min(samples.length, Math.floor((f + 1) * perFrame));
    let sum = 0;
    for (let i = start; i < end; i++) sum += (samples[i] / 32768) ** 2;
    rms[f] = Math.sqrt(sum / Math.max(1, end - start));
  }
  const sorted = Array.from(rms).sort((a, b) => a - b);
  const p90 = sorted[Math.floor(sorted.length * 0.9)] ?? 0;
  const threshold = Math.max(0.015, p90 * 0.3);

  const open = Array.from(rms, (v) => v > threshold);
  // Lấp khoảng khép 1 frame và bỏ khoảng mở 1 frame để miệng không nháy
  for (let i = 1; i < open.length - 1; i++) {
    if (!open[i] && open[i - 1] && open[i + 1]) open[i] = true;
  }
  for (let i = 1; i < open.length - 1; i++) {
    if (open[i] && !open[i - 1] && !open[i + 1]) open[i] = false;
  }
  // Nhịp đóng/mở giả lập âm tiết: khi nói liên tục, frame thứ 5 khép lại nếu không phải đoạn to
  let run = 0;
  for (let i = 0; i < open.length; i++) {
    run = open[i] ? run + 1 : 0;
    if (run > 0 && run % 5 === 0 && rms[i] < p90) open[i] = false;
  }

  // Độ lớn giọng 0..9 mỗi frame, dùng cho nhún người khi nói
  const peak = sorted[Math.floor(sorted.length * 0.98)] || 1;
  const level = Array.from(rms, (v) => String(Math.min(9, Math.round((v / peak) * 9)))).join('');
  return { durationMs, mouth: open.map((o) => (o ? '1' : '0')).join(''), level };
}

// ---------------------------------------------------------------------------
// Cắt audio đọc nhiều câu liền (một request TTS cho nhiều câu của cùng một giọng) thành từng câu
// ---------------------------------------------------------------------------

export interface Gap {
  start: number; // sample
  end: number;
}

export interface VoiceGaps {
  gaps: Gap[];
  voiceStart: number;
  voiceEnd: number;
  sampleRate: number;
}

/** Các khoảng lặng dài ≥ minMs nằm giữa đoạn có tiếng (bỏ khoảng lặng đầu/cuối). */
export function findGaps(w: WavInfo, minMs = 150): VoiceGaps {
  const win = Math.max(1, Math.round(w.sampleRate * 0.01));
  const n = Math.floor(w.samples.length / win);
  const rms = new Float64Array(n);
  for (let f = 0; f < n; f++) {
    let sum = 0;
    for (let i = f * win; i < (f + 1) * win; i++) sum += (w.samples[i] / 32768) ** 2;
    rms[f] = Math.sqrt(sum / win);
  }
  const sorted = Array.from(rms).sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  const threshold = Math.max(0.004, p95 * 0.05);
  const voiced = Array.from(rms, (v) => v > threshold);
  const first = voiced.indexOf(true);
  const last = voiced.lastIndexOf(true);
  if (first < 0) return { gaps: [], voiceStart: 0, voiceEnd: w.samples.length, sampleRate: w.sampleRate };

  const gaps: Gap[] = [];
  const minFrames = Math.ceil(minMs / 10);
  let runStart = -1;
  for (let f = first; f <= last; f++) {
    if (!voiced[f]) {
      if (runStart < 0) runStart = f;
    } else if (runStart >= 0) {
      if (f - runStart >= minFrames) gaps.push({ start: runStart * win, end: f * win });
      runStart = -1;
    }
  }
  return { gaps, voiceStart: first * win, voiceEnd: (last + 1) * win, sampleRate: w.sampleRate };
}

/**
 * Chọn N-1 khoảng lặng làm điểm cắt giữa N câu: ưu tiên khoảng lặng dài (nghỉ giữa hai câu thường dài hơn
 * nghỉ trong câu) và nằm gần vị trí dự kiến theo độ dài chữ của từng câu. Quy hoạch động, giữ đúng thứ tự.
 * Trả về chỉ số các gap được chọn, hoặc null nếu không đủ khoảng lặng.
 */
export function chooseCuts(v: VoiceGaps, weights: number[]): number[] | null {
  const K = weights.length - 1;
  if (K <= 0) return [];
  const G = v.gaps.length;
  if (G < K) return null;
  const total = Math.max(1, v.voiceEnd - v.voiceStart);
  const sumW = weights.reduce((a, b) => a + b, 0) || 1;
  const expected: number[] = [];
  let acc = 0;
  for (let k = 0; k < K; k++) {
    acc += weights[k];
    expected.push(v.voiceStart + (total * acc) / sumW);
  }
  const lenCap = 1.2 * v.sampleRate;
  const score = (g: number, k: number) => {
    const gap = v.gaps[g];
    const mid = (gap.start + gap.end) / 2;
    return Math.min(gap.end - gap.start, lenCap) / lenCap - (4 * Math.abs(mid - expected[k])) / total;
  };

  const dp: number[][] = Array.from({ length: K }, () => new Array(G).fill(-Infinity));
  const from: number[][] = Array.from({ length: K }, () => new Array(G).fill(-1));
  for (let g = 0; g < G; g++) dp[0][g] = score(g, 0);
  for (let k = 1; k < K; k++) {
    let best = -Infinity;
    let bestIdx = -1;
    for (let g = k; g < G; g++) {
      if (dp[k - 1][g - 1] > best) {
        best = dp[k - 1][g - 1];
        bestIdx = g - 1;
      }
      if (bestIdx >= 0) {
        dp[k][g] = best + score(g, k);
        from[k][g] = bestIdx;
      }
    }
  }
  let end = -1;
  let bestScore = -Infinity;
  for (let g = K - 1; g < G; g++) {
    if (dp[K - 1][g] > bestScore) {
      bestScore = dp[K - 1][g];
      end = g;
    }
  }
  if (end < 0) return null;
  const cuts = new Array<number>(K);
  for (let k = K - 1; k >= 0; k--) {
    cuts[k] = end;
    end = from[k][end];
  }
  return cuts;
}

/** Cắt thành từng câu theo các gap đã chọn; chừa một ít lặng trước/sau cho tự nhiên. */
export function sliceByCuts(w: WavInfo, v: VoiceGaps, cuts: number[]): Buffer[] {
  const pre = Math.round(0.05 * w.sampleRate);
  const tail = Math.round(0.12 * w.sampleRate);
  const bounds: [number, number][] = [];
  let start = Math.max(0, v.voiceStart - pre);
  for (const c of cuts) {
    const gap = v.gaps[c];
    bounds.push([start, Math.min(gap.end, gap.start + tail)]);
    start = Math.max(gap.start, gap.end - pre);
  }
  bounds.push([start, Math.min(w.samples.length, v.voiceEnd + tail)]);
  return bounds.map(([a, b]) => samplesToWav(w.samples.subarray(a, b), w.sampleRate));
}

export function samplesToWav(samples: Int16Array, sampleRate: number): Buffer {
  const fade = Math.min(Math.round(sampleRate * 0.005), Math.floor(samples.length / 2));
  const pcm = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    let v = samples[i];
    if (i < fade) v = Math.round((v * i) / fade);
    else if (i >= samples.length - fade) v = Math.round((v * (samples.length - 1 - i)) / fade);
    pcm.writeInt16LE(v, i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
