import sharp from 'sharp';

/**
 * Ghép bộ dáng nhân vật thành "rig" ổn định.
 *
 * Mỗi dáng/khẩu hình là một lần AI sửa ảnh riêng nên nét viền, tóc, mắt lệch nhau vài pixel; đổi nguyên ảnh
 * theo từng âm tiết làm nhân vật rung. Ở đây ảnh đứng (idle) là nền cố định:
 * - dáng tay: chỉ lấy vùng tay thực sự thay đổi dán lên ảnh đứng, đầu và thân giữ nguyên từng pixel;
 * - miệng / chớp mắt: tách thành miếng dán nhỏ (RGBA trong suốt) đặt chồng lên mặt.
 */

export interface RigImage {
  data: Buffer; // RGBA thô
  width: number;
  height: number;
}

export interface RigBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface ComposedRig {
  /** Ảnh toàn thân đã ghép cho từng dáng (cùng kích thước) */
  poses: Record<string, Buffer>;
  /** Miếng dán miệng mở / mắt nhắm (PNG trong suốt cùng kích thước) */
  mouth: Buffer;
  blink: Buffer;
  /** Miếng dán biểu cảm vùng mắt + lông mày (vui, ngạc nhiên, suy nghĩ); miệng vẫn nhép như thường */
  expressions: Record<string, Buffer>;
  head: RigBox;
  /** Vùng miệng (để căn khung trung/cận cảnh không cắt mất miệng) */
  mouthBox: RigBox;
  /** Phần trăm diện tích ảnh được thay ở từng dáng (để kiểm tra dáng có thật sự khác không) */
  coverage: Record<string, number>;
}

export async function loadRgba(png: Buffer): Promise<RigImage> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

const toPng = (data: Buffer | Uint8Array, width: number, height: number) =>
  sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();

/** Độ khác nhau từng pixel giữa hai ảnh RGBA, 0..255 */
function diffMap(a: RigImage, b: RigImage, threshold: number): Uint8Array {
  const n = a.width * a.height;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const aa = a.data[o + 3];
    const ba = b.data[o + 3];
    if (aa < 24 && ba < 24) continue;
    let d = Math.abs(aa - ba);
    if (aa >= 24 && ba >= 24) {
      d = Math.max(
        d,
        Math.abs(a.data[o] - b.data[o]),
        Math.abs(a.data[o + 1] - b.data[o + 1]),
        Math.abs(a.data[o + 2] - b.data[o + 2]),
      );
    }
    out[i] = d >= threshold ? 1 : 0;
  }
  return out;
}

/** Tổng tích luỹ 2D để lọc hộp O(N) */
function integral(m: ArrayLike<number>, w: number, h: number): Float64Array {
  const s = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += m[y * w + x];
      s[(y + 1) * (w + 1) + x + 1] = s[y * (w + 1) + x + 1] + row;
    }
  }
  return s;
}

function boxSum(s: Float64Array, w: number, h: number, x: number, y: number, r: number) {
  const x1 = Math.max(0, x - r);
  const y1 = Math.max(0, y - r);
  const x2 = Math.min(w, x + r + 1);
  const y2 = Math.min(h, y + r + 1);
  const W = w + 1;
  return { sum: s[y2 * W + x2] - s[y1 * W + x2] - s[y2 * W + x1] + s[y1 * W + x1], area: (x2 - x1) * (y2 - y1) };
}

function dilate(m: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const s = integral(m, w, h);
  const out = new Uint8Array(m.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = boxSum(s, w, h, x, y, r).sum > 0 ? 1 : 0;
  return out;
}

function erode(m: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const s = integral(m, w, h);
  const out = new Uint8Array(m.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const b = boxSum(s, w, h, x, y, r);
      out[y * w + x] = b.sum >= b.area ? 1 : 0;
    }
  return out;
}

/** Làm mềm mép mặt nạ → 0..1 */
function feather(m: Uint8Array, w: number, h: number, r: number): Float32Array {
  const s = integral(m, w, h);
  const out = new Float32Array(m.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const b = boxSum(s, w, h, x, y, r);
      out[y * w + x] = b.sum / b.area;
    }
  return out;
}

interface Component {
  area: number;
  box: RigBox;
  pixels: Int32Array;
}

function components(m: Uint8Array, w: number, h: number): Component[] {
  const seen = new Uint8Array(m.length);
  const queue = new Int32Array(m.length);
  const out: Component[] = [];
  for (let start = 0; start < m.length; start++) {
    if (!m[start] || seen[start]) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    seen[start] = 1;
    const box = { x1: w, y1: h, x2: 0, y2: 0 };
    while (head < tail) {
      const p = queue[head++];
      const x = p % w;
      const y = (p - x) / w;
      if (x < box.x1) box.x1 = x;
      if (x > box.x2) box.x2 = x;
      if (y < box.y1) box.y1 = y;
      if (y > box.y2) box.y2 = y;
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      for (const q of nb) {
        if (q >= 0 && m[q] && !seen[q]) {
          seen[q] = 1;
          queue[tail++] = q;
        }
      }
    }
    out.push({ area: tail, box, pixels: queue.slice(0, tail) });
  }
  return out.sort((a, b) => b.area - a.area);
}

function fromComponents(list: Component[], n: number): Uint8Array {
  const m = new Uint8Array(n);
  for (const c of list) for (const p of c.pixels) m[p] = 1;
  return m;
}

/** Bỏ nét mảnh (viền lệch 1–3 px giữa các lần vẽ), chỉ giữ vùng thay đổi thật */
function solidChanges(a: RigImage, b: RigImage, threshold: number, radius: number): Uint8Array {
  const { width: w, height: h } = a;
  return dilate(erode(diffMap(a, b, threshold), w, h, radius), w, h, radius);
}

const union = (a: RigBox, b: RigBox): RigBox => ({
  x1: Math.min(a.x1, b.x1),
  y1: Math.min(a.y1, b.y1),
  x2: Math.max(a.x2, b.x2),
  y2: Math.max(a.y2, b.y2),
});

/** Tìm đầu nhân vật: dựa vào vị trí miệng (idle ↔ idleOpen) và mắt (idle ↔ blink) */
function findHead(idle: RigImage, open: RigImage, blink: RigImage) {
  const { width: w, height: h } = idle;
  // Chỉ xét phía trong hình bóng: nhân vật trong suốt/phát sáng (mascot giọt nước, kính...) bị vẽ lại viền khác nhau
  // giữa các lần sửa ảnh, vùng viền đổi còn lớn hơn cả cái miệng nên trước đây bị nhận nhầm là miệng.
  const inside = erode(opaque(idle), w, h, Math.max(4, Math.round(w * 0.012)));
  // Mascot đầu to thân nhỏ có miệng nằm quá nửa khung, nên xét tới 70% chiều cao rồi chọn theo vị trí mắt
  const upper = (m: Uint8Array) => {
    for (let i = 0; i < m.length; i++) if (!inside[i] || i >= Math.floor(h * 0.7) * w) m[i] = 0;
    return m;
  };
  // Miệng, mắt là mảng gọn, không phải dải dài theo chiều dọc như viền đầu
  const compact = (c: Component) => c.box.y2 - c.box.y1 <= (c.box.x2 - c.box.x1 + 1) * 1.6;
  const pick = (all: Component[]) => (all.some(compact) ? all.filter(compact) : all);
  const mouthC = pick(components(upper(solidChanges(idle, open, 40, 1)), w, h));
  const eyeC = pick(components(upper(solidChanges(idle, blink, 40, 1)), w, h));
  // Miệng = mảng thay đổi lớn nhất nằm dưới và giữa hai mắt (mắt lấy từ ảnh chớp mắt)
  let mouth = mouthC[0];
  if (eyeC.length) {
    const pair = eyeC.slice(0, 2).reduce((b, c) => union(b, c.box), eyeC[0].box);
    const span = Math.max(pair.x2 - pair.x1, (pair.y2 - pair.y1) * 2);
    const midY = (pair.y1 + pair.y2) / 2;
    mouth =
      mouthC.find((c) => {
        const cx = (c.box.x1 + c.box.x2) / 2;
        const cy = (c.box.y1 + c.box.y2) / 2;
        return cy > midY && cx >= pair.x1 - span * 0.4 && cx <= pair.x2 + span * 0.4 && c.box.y1 <= pair.y2 + span * 1.2;
      }) ?? mouth;
  }
  if (!mouth) throw new Error('Không tìm thấy miệng trên ảnh nhân vật');
  // Mắt: các mảnh lớn nằm trên miệng
  const eyes = eyeC.filter((c) => c.box.y2 <= mouth.box.y2 && c.area >= mouth.area * 0.08).slice(0, 2);
  const face = eyes.reduce((b, c) => union(b, c.box), mouth.box);

  // Đỉnh đầu = dòng đầu tiên có pixel; cổ = dòng hẹp nhất của hình bóng ngay dưới miệng
  const rowWidth = (y: number) => {
    let x1 = -1;
    let x2 = -1;
    for (let x = 0; x < w; x++)
      if (idle.data[(y * w + x) * 4 + 3] > 40) {
        if (x1 < 0) x1 = x;
        x2 = x;
      }
    return x1 < 0 ? { x1: 0, x2: -1, width: 0 } : { x1, x2, width: x2 - x1 + 1 };
  };
  let top = 0;
  while (top < h - 1 && rowWidth(top).width === 0) top++;
  const faceH = Math.max(face.y2 - face.y1, mouth.box.y2 - mouth.box.y1);
  let neck = Math.min(h - 1, mouth.box.y2 + faceH);
  let best = Infinity;
  for (let y = mouth.box.y2 + 2; y <= Math.min(h - 1, mouth.box.y2 + faceH * 1.6); y++) {
    const rw = rowWidth(y).width;
    if (rw > 0 && rw < best) {
      best = rw;
      neck = y;
    }
  }
  let x1 = w;
  let x2 = 0;
  for (let y = top; y <= neck; y++) {
    const r = rowWidth(y);
    if (r.width && r.x1 < x1) x1 = r.x1;
    if (r.width && r.x2 > x2) x2 = r.x2;
  }
  return {
    head: { x1, y1: top, x2, y2: neck },
    mouth: mouthC.filter((c) => c.box.y1 >= face.y1 && c.area >= mouth.area * 0.15),
    eyes,
  };
}

/** Mặt nạ đầu: pixel của ảnh đứng nằm trên cổ — dáng tay không được đè lên (ngoài viền đầu thì tay được vẽ sát vào) */
function headMask(idle: RigImage, head: RigBox): Uint8Array {
  const { width: w, height: h } = idle;
  const m = new Uint8Array(w * h);
  for (let y = head.y1; y <= head.y2; y++)
    for (let x = head.x1; x <= head.x2; x++) if (idle.data[(y * w + x) * 4 + 3] > 24) m[y * w + x] = 1;
  return m;
}

function opaque(img: RigImage): Uint8Array {
  const m = new Uint8Array(img.width * img.height);
  for (let i = 0; i < m.length; i++) m[i] = img.data[i * 4 + 3] > 40 ? 1 : 0;
  return m;
}

const inBox = (b: RigBox, x: number, y: number) => x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2;

/** Trộn ảnh `top` lên `base` theo mặt nạ mềm (alpha premultiplied để không viền đen) */
function blend(base: RigImage, top: RigImage, m: Float32Array): Uint8Array {
  const out = new Uint8Array(base.data.length);
  for (let i = 0; i < m.length; i++) {
    const o = i * 4;
    const t = m[i];
    const ab = base.data[o + 3] / 255;
    const at = top.data[o + 3] / 255;
    const a = ab * (1 - t) + at * t;
    out[o + 3] = Math.round(a * 255);
    if (a <= 0) continue;
    for (let c = 0; c < 3; c++) out[o + c] = Math.round((base.data[o + c] * ab * (1 - t) + top.data[o + c] * at * t) / a);
  }
  return out;
}

/** Miếng dán trong suốt: màu của `src`, độ đục = mặt nạ × alpha */
function patch(src: RigImage, m: Float32Array): Uint8Array {
  const out = new Uint8Array(src.data.length);
  for (let i = 0; i < m.length; i++) {
    const o = i * 4;
    out[o] = src.data[o];
    out[o + 1] = src.data[o + 1];
    out[o + 2] = src.data[o + 2];
    out[o + 3] = Math.round(src.data[o + 3] * m[i]);
  }
  return out;
}

/**
 * @param images ảnh đã tách nền, cùng khung: phải có idle, idleOpen, blink và các dáng tay
 * @param poseKeys các dáng tay cần ghép (talk, explain, point, cheer...)
 * @param expressionKeys ảnh biểu cảm (chỉ đổi mắt, lông mày) cần tách thành miếng dán
 */
export async function composeRig(images: Record<string, Buffer>, poseKeys: string[], expressionKeys: string[] = []): Promise<ComposedRig> {
  const idle = await loadRgba(images.idle);
  const open = await loadRgba(images.idleOpen);
  const blink = await loadRgba(images.blink);
  const { width: w, height: h } = idle;
  const n = w * h;
  const found = findHead(idle, open, blink);
  const head = found.head;
  const protect = headMask(idle, head);

  const poses: Record<string, Buffer> = { idle: await toPng(idle.data, w, h) };
  const coverage: Record<string, number> = { idle: 0 };
  for (const k of poseKeys) {
    const img = await loadRgba(images[k]);
    // Chỉ lấy phần dính liền với thân: chữ, hoạ tiết AI vẽ lơ lửng quanh người bị bỏ
    const body = components(opaque(img), w, h)[0];
    const attached = body ? fromComponents([body], n) : new Uint8Array(n);
    // Mảnh rời khỏi thân coi như nền trong suốt: model ảnh hay để sót bóng mờ của bàn tay cũ khi đổi dáng tay
    // (mascot chính diện), giữ nguyên thì bóng tay bị dán đè lên chỗ tay cũ thay vì xoá đi. Nới 2px để giữ mép mềm của thân.
    const keep = dilate(attached, w, h, 2);
    for (let i = 0; i < n; i++) if (!keep[i]) img.data[i * 4 + 3] = 0;
    // Vùng thay đổi thật (tay), bỏ vùng quá nhỏ và toàn bộ phần đầu
    const solid = solidChanges(idle, img, 48, 3);
    for (let i = 0; i < n; i++) if (!attached[i] && !idle.data[i * 4 + 3]) solid[i] = 0;
    const big = components(solid, w, h).filter((c) => c.area >= n * 0.0015);
    const m = fromComponents(big, n);
    // Nới rộng để lấy trọn viền tay và vùng tay cũ cần xoá, rồi làm mềm mép; đầu luôn giữ của ảnh đứng
    const soft = feather(dilate(m, w, h, 10), w, h, 4);
    for (let i = 0; i < n; i++) if (protect[i]) soft[i] = 0;
    coverage[k] = soft.reduce((a, b) => a + b, 0) / n;
    poses[k] = await toPng(blend(idle, img, soft), w, h);
  }

  const facePatch = async (src: RigImage, parts: Component[]) => {
    const m = fromComponents(parts, n);
    for (let i = 0; i < n; i++) if (m[i] && !inBox(head, i % w, Math.floor(i / w))) m[i] = 0;
    return toPng(patch(src, feather(dilate(m, w, h, 6), w, h, 3)), w, h);
  };
  const mouthBox = found.mouth.length ? found.mouth.map((c) => c.box).reduce(union) : head;

  // Biểu cảm: chỉ lấy phần thay đổi trong vùng mắt + lông mày (phía trong mặt, trên miệng) — tóc, viền đầu,
  // miệng giữ của ảnh đứng nên ghép lên không lệch và miệng vẫn nhép theo lời
  const expressions: Record<string, Buffer> = {};
  if (found.eyes.length && expressionKeys.length) {
    const eyes = found.eyes.map((c) => c.box).reduce(union);
    const ew = eyes.x2 - eyes.x1;
    const eh = Math.max(eyes.y2 - eyes.y1, ew * 0.25);
    const region: RigBox = {
      x1: Math.max(head.x1, Math.round(eyes.x1 - ew * 0.35)),
      x2: Math.min(head.x2, Math.round(eyes.x2 + ew * 0.35)),
      y1: Math.max(head.y1, Math.round(eyes.y1 - eh * 1.3)),
      y2: Math.min(mouthBox.y1 - 2, Math.round(eyes.y2 + eh * 0.6)),
    };
    const inside = erode(opaque(idle), w, h, Math.max(3, Math.round(w * 0.008)));
    for (const k of expressionKeys) {
      if (!images[k]) continue;
      const img = await loadRgba(images[k]);
      const changed = solidChanges(idle, img, 40, 1);
      for (let i = 0; i < n; i++) if (changed[i] && (!inside[i] || !inBox(region, i % w, Math.floor(i / w)))) changed[i] = 0;
      const parts = components(changed, w, h).filter((c) => c.area >= n * 0.00008);
      const m = fromComponents(parts, n);
      const area = m.reduce((a, b) => a + b, 0);
      // Lần sửa ảnh không đổi gì ở mắt: bỏ biểu cảm này
      if (area < n * 0.0003) continue;
      const soft = feather(dilate(m, w, h, 7), w, h, 3);
      for (let i = 0; i < n; i++) if (!inBox(region, i % w, Math.floor(i / w))) soft[i] = 0;
      expressions[k] = await toPng(patch(img, soft), w, h);
    }
  }
  return {
    poses,
    mouth: await facePatch(open, found.mouth),
    blink: await facePatch(blink, found.eyes),
    expressions,
    head,
    mouthBox,
    coverage,
  };
}
