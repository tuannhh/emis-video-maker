import sharp from 'sharp';

/**
 * Tách nhân vật/vật khỏi nền một màu (mặc định magenta #FF00FF) do model ảnh vẽ.
 * Loang (flood fill) từ mép ảnh nên không làm thủng các chi tiết cùng tông màu bên trong hình,
 * sau đó làm mềm viền và khử ám màu nền ở rìa.
 */

/** Màu nền dùng để tách: hình minh hoạ chọn màu không trùng màu của chính vật (lợn hồng → nền xanh lá) */
export type KeyColor = 'magenta' | 'green' | 'blue';

/** Kênh màu nổi trội của từng màu nền (R=0, G=1, B=2) */
const KEY_CHANNELS: Record<KeyColor, { hi: number[]; lo: number[] }> = {
  magenta: { hi: [0, 2], lo: [1] },
  green: { hi: [1], lo: [0, 2] },
  blue: { hi: [2], lo: [0, 1] },
};

export const KEY_HEX: Record<KeyColor, string> = { magenta: '#FF00FF', green: '#00FF00', blue: '#0000FF' };

/** Từ chỉ màu/vật có màu trùng từng màu nền (mô tả tiếng Anh) */
const KEY_CLASH: Record<KeyColor, RegExp> = {
  magenta:
    /\b(pink|purple|magenta|violet|lilac|lavender|mauve|fuchsia|grapes?|plums?|eggplants?|aubergines?|pigs?|piglets?|flamingos?|roses?|orchids?|lotus|beets?|beetroots?|dragon ?fruits?|cherry blossoms?|peach blossoms?)\b/i,
  green:
    /\b(green|lime|leaf|leaves|grass|trees?|plants?|frogs?|cucumbers?|lettuce|cabbages?|broccoli|peas?|turtles?|crocodiles?|caterpillars?|cactus|bamboo|watermelons?|avocados?)\b/i,
  blue: /\b(blue|navy|cyan|turquoise|sky|water|sea|ocean|river|lake|whales?|dolphins?|blueberr(y|ies)|jeans|bluebirds?)\b/i,
};

/** Màu nền tách hợp với một vật: màu đầu tiên không trùng màu của vật */
export function keyColorFor(description: string): KeyColor {
  return (['magenta', 'green', 'blue'] as const).find((k) => !KEY_CLASH[k].test(description)) ?? 'magenta';
}

interface Raw {
  data: Buffer;
  width: number;
  height: number;
}

async function toRaw(input: Buffer): Promise<Raw> {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** Mức "giống màu nền" của pixel: kênh nổi trội yếu nhất trừ kênh còn lại mạnh nhất. Nền thuần ≈ 255. */
function keyness(d: Buffer, i: number, key: KeyColor) {
  const { hi, lo } = KEY_CHANNELS[key];
  return Math.min(...hi.map((c) => d[i + c])) - Math.max(...lo.map((c) => d[i + c]));
}

function keyOut({ data, width, height }: Raw, key: KeyColor = 'magenta'): Buffer {
  const { hi, lo } = KEY_CHANNELS[key];
  const out = Buffer.from(data);
  const n = width * height;
  const bg = new Uint8Array(n);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  const isBgCandidate = (p: number) => {
    const i = p * 4;
    return keyness(data, i, key) > 70 && hi.every((c) => data[i + c] > 110);
  };
  const push = (p: number) => {
    if (!bg[p] && isBgCandidate(p)) {
      bg[p] = 1;
      queue[tail++] = p;
    }
  };
  for (let x = 0; x < width; x++) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    push(y * width);
    push(y * width + width - 1);
  }
  const flood = () => {
    while (head < tail) {
      const p = queue[head++];
      const x = p % width;
      if (x > 0) push(p - 1);
      if (x < width - 1) push(p + 1);
      if (p >= width) push(p - width);
      if (p < n - width) push(p + width);
    }
  };
  flood();

  // Khoảng nền bị kẹp kín (giữa tay và thân...) không nối với mép ảnh: loang tiếp từ các pixel
  // đậm màu nền. Hình được yêu cầu không có màu nền nên không sợ ăn vào chi tiết thật.
  // Nền magenta nhìn qua tròng kính bị model vẽ nhạt đi (≈ 250,155,245): cũng tính là nền.
  for (let p = 0; p < n; p++) {
    if (bg[p]) continue;
    const i = p * 4;
    const his = hi.map((c) => data[i + c]);
    const spread = Math.max(...his) - Math.min(...his);
    const strong = his.every((v) => v > 170) && lo.every((c) => data[i + c] < 90) && spread < 70;
    const washed = key === 'magenta' && his.every((v) => v > 215) && keyness(data, i, key) > 60 && spread < 30;
    if (strong || washed) {
      bg[p] = 1;
      queue[tail++] = p;
    }
  }
  flood();

  for (let p = 0; p < n; p++) {
    const i = p * 4;
    if (bg[p]) {
      out[i + 3] = 0;
      continue;
    }
    // Pixel sát nền: alpha theo mức giống màu nền, khử ám màu
    const x = p % width;
    const nearBg =
      (x > 0 && bg[p - 1]) ||
      (x < width - 1 && bg[p + 1]) ||
      (p >= width && bg[p - width]) ||
      (p < n - width && bg[p + width]);
    if (!nearBg) continue;
    const m = keyness(data, i, key);
    if (m > 20) {
      const alpha = Math.max(0, Math.min(1, 1 - (m - 20) / 140));
      out[i + 3] = Math.round(255 * alpha);
      for (const c of hi) out[i + c] = Math.max(0, data[i + c] - m * 0.7);
    }
  }
  return out;
}

function alphaBounds(data: Buffer, width: number, height: number) {
  let x1 = width;
  let y1 = height;
  let x2 = -1;
  let y2 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 16) {
        if (x < x1) x1 = x;
        if (x > x2) x2 = x;
        if (y < y1) y1 = y;
        if (y > y2) y2 = y;
      }
    }
  }
  if (x2 < 0) return { left: 0, top: 0, width, height };
  return { left: x1, top: y1, width: x2 - x1 + 1, height: y2 - y1 + 1 };
}

export interface CutoutResult {
  images: Buffer[]; // PNG trong suốt, cùng khung cắt
  width: number;
  height: number;
  /** Mép trên của phần có hình trong từng ảnh, tỉ lệ theo chiều cao khung chung */
  tops: number[];
  /** Tâm ngang của phần có hình trong từng ảnh, tỉ lệ theo chiều rộng khung chung */
  centersX: number[];
}

/**
 * Tách nền cho nhiều biến thể của cùng một nhân vật và cắt chung một khung,
 * để các ảnh chồng khít lên nhau khi đổi khẩu hình.
 */
export async function cutoutVariants(inputs: Buffer[], maxHeight = 1400, key: KeyColor = 'magenta'): Promise<CutoutResult> {
  const raws = await Promise.all(inputs.map(toRaw));
  const { width, height } = raws[0];
  const keyed = await Promise.all(
    raws.map(async (r) => {
      // Các biến thể có thể lệch kích thước vài pixel: đưa về cùng kích thước ảnh gốc
      if (r.width === width && r.height === height) return keyOut(r, key);
      const resized = await toRaw(
        await sharp(r.data, { raw: { width: r.width, height: r.height, channels: 4 } })
          .resize(width, height, { fit: 'fill' })
          .png()
          .toBuffer(),
      );
      return keyOut(resized, key);
    }),
  );

  const bounds = keyed.map((d) => alphaBounds(d, width, height));
  const pad = 12;
  const left = Math.max(0, Math.min(...bounds.map((b) => b.left)) - pad);
  const top = Math.max(0, Math.min(...bounds.map((b) => b.top)) - pad);
  const right = Math.min(width, Math.max(...bounds.map((b) => b.left + b.width)) + pad);
  const bottom = Math.min(height, Math.max(...bounds.map((b) => b.top + b.height)) + pad);
  const crop = { left, top, width: right - left, height: bottom - top };
  const scale = Math.min(1, maxHeight / crop.height);

  const images = await Promise.all(
    keyed.map((d) =>
      sharp(d, { raw: { width, height, channels: 4 } })
        .extract(crop)
        .resize(Math.round(crop.width * scale), Math.round(crop.height * scale))
        .png({ compressionLevel: 9 })
        .toBuffer(),
    ),
  );
  const tops = bounds.map((b) => Math.max(0, (b.top - crop.top) / crop.height));
  const centersX = bounds.map((b) => (b.left + b.width / 2 - crop.left) / crop.width);
  return { images, width: Math.round(crop.width * scale), height: Math.round(crop.height * scale), tops, centersX };
}
