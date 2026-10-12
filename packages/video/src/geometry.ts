import type { Box, Framing, RenderCharacter, RenderSceneCharacter } from '@edu/shared';

export interface CoverLayout {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Vị trí ảnh nền khi phủ kín khung hình (object-fit: cover). */
export function coverLayout(imgW: number, imgH: number, W: number, H: number): CoverLayout {
  const scale = Math.max(W / imgW, H / imgH);
  const width = imgW * scale;
  const height = imgH * scale;
  return { left: (W - width) / 2, top: (H - height) / 2, width, height };
}

export interface Rect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Đổi box chuẩn hóa theo ảnh sang toạ độ pixel của khung hình (trước khi zoom). */
export function boxToFrame(box: Box, layout: CoverLayout): Rect {
  const [ymin, xmin, ymax, xmax] = box;
  return {
    x1: layout.left + xmin * layout.width,
    y1: layout.top + ymin * layout.height,
    x2: layout.left + xmax * layout.width,
    y2: layout.top + ymax * layout.height,
  };
}

/** Nhân vật trong toạ độ khung hình (trước khi zoom) */
export interface Placed {
  id: string;
  x: number;
  feet: number;
  bodyH: number;
  head: number;
  /** Toạ độ y của miệng; null nếu không rõ */
  mouth: number | null;
}

export function placeCharacter(c: RenderSceneCharacter, layout: CoverLayout, ch?: RenderCharacter): Placed {
  const x = layout.left + c.x * layout.width;
  const feet = layout.top + c.feetY * layout.height;
  const bodyH = c.bodyHeight * layout.height;
  // Cùng phép đặt ảnh như CharacterRig: khung ảnh cao hơn thân một đoạn headTop
  const spriteH = ch ? bodyH / Math.max(0.3, 1 - ch.headTop) : 0;
  const mouth = ch?.mouthY != null ? feet - spriteH + ch.mouthY * spriteH : null;
  return { id: c.id, x, feet, bodyH, head: feet - bodyH, mouth };
}

/** Miệng người nói phải nằm trên tỉ lệ này của khung (phía dưới là phụ đề) */
const MOUTH_LIMIT = 0.66;

export interface CameraState {
  scale: number;
  cx: number; // tâm nhìn, pixel khung hình
  cy: number;
}

export const MAX_SCALE = 3.2;

/** Mở rộng khung chữ nhật cho đúng tỉ lệ màn hình, giữ tâm. */
function fitAspect(r: Rect, W: number, H: number): Rect {
  const cx = (r.x1 + r.x2) / 2;
  const cy = (r.y1 + r.y2) / 2;
  let w = Math.max(1, r.x2 - r.x1);
  let h = Math.max(1, r.y2 - r.y1);
  if (w / h > W / H) h = (w * H) / W;
  else w = (h * W) / H;
  return { x1: cx - w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2 };
}

function rectCamera(r: Rect, W: number, H: number): CameraState {
  const f = fitAspect(r, W, H);
  const scale = clamp(W / (f.x2 - f.x1), 1, MAX_SCALE);
  return { scale, cx: (f.x1 + f.x2) / 2, cy: (f.y1 + f.y2) / 2 };
}

export interface FramingInput {
  framing: Framing;
  speaker: Placed | null;
  listener: Placed | null;
  /** Hướng người nói đang nhìn: 1 = sang phải, -1 = sang trái */
  speakerFacing: 1 | -1;
  target: Rect | null;
}

/**
 * Khung hình cho từng cỡ cảnh. Trung cảnh/cận cảnh đặt người nói lệch về một phần ba khung,
 * chừa khoảng trống phía trước mặt (look room) như quay phim thật.
 */
export function framingCamera(input: FramingInput, W: number, H: number): CameraState {
  const { framing, speaker: s, listener: l, target } = input;
  const wide: CameraState = { scale: 1, cx: W / 2, cy: H / 2 };
  const d = input.speakerFacing;

  if (framing === 'object') {
    if (!target) return wide;
    const mx = (target.x2 - target.x1) * 0.45;
    const my = (target.y2 - target.y1) * 0.45;
    const cam = rectCamera({ x1: target.x1 - mx, y1: target.y1 - my, x2: target.x2 + mx, y2: target.y2 + my }, W, H);
    return { ...cam, scale: Math.min(cam.scale, 2.6) };
  }
  if (!s) return wide;

  if (framing === 'medium' || framing === 'close-up') {
    const close = framing === 'close-up';
    const top = s.head - s.bodyH * (close ? 0.07 : 0.09);
    // Mascot mặt thấp trên thân: nới khung cho miệng nằm trên vùng phụ đề, không bị cắt
    const h = Math.max(s.bodyH * (close ? 0.44 : 0.72), s.mouth != null ? (s.mouth - top) / MOUTH_LIMIT : 0);
    const w = (h * W) / H;
    const cx = s.x + d * w * (close ? 0.1 : 0.14);
    return rectCamera({ x1: cx - w / 2, y1: top, x2: cx + w / 2, y2: top + h }, W, H);
  }

  if (framing === 'two-shot') {
    const other = l ?? null;
    if (!other) {
      const h = s.bodyH * 0.95;
      const w = (h * W) / H;
      return rectCamera({ x1: s.x - w / 2, y1: s.head - s.bodyH * 0.1, x2: s.x + w / 2, y2: s.head + h }, W, H);
    }
    const bodyH = Math.max(s.bodyH, other.bodyH);
    const x1 = Math.min(s.x, other.x) - bodyH * 0.32;
    const x2 = Math.max(s.x, other.x) + bodyH * 0.32;
    const y1 = Math.min(s.head, other.head) - bodyH * 0.1;
    const mouths = [s.mouth, other.mouth].filter((m): m is number => m != null);
    const y2 = Math.max(Math.min(s.head, other.head) + bodyH * 0.85, ...mouths.map((m) => y1 + (m - y1) / MOUTH_LIMIT));
    return rectCamera({ x1, y1, x2, y2 }, W, H);
  }
  return wide;
}

/** Chuyển động chậm trong suốt shot (p: 0 → 1) */
export function applyMotion(cam: CameraState, motion: string, p: number, W: number, facing: 1 | -1): CameraState {
  const e = 0.5 - Math.cos(Math.PI * clamp(p, 0, 1)) / 2; // ease in-out sine
  switch (motion) {
    case 'push-in':
      return { ...cam, scale: cam.scale * (1 + 0.07 * e) };
    case 'pull-out':
      return { ...cam, scale: cam.scale * (1.07 - 0.07 * e) };
    case 'pan': {
      const span = (W / cam.scale) * 0.08;
      return { ...cam, scale: cam.scale * 1.04, cx: cam.cx + facing * span * (e - 0.5) };
    }
    default:
      // "static": vẫn nhích rất nhẹ để khung hình không chết
      return { ...cam, scale: cam.scale * (1 + 0.015 * e) };
  }
}

/** Nội suy camera: zoom theo thang log để tốc độ phóng đều mắt, tâm nội suy tuyến tính */
export function lerpCamera(a: CameraState, b: CameraState, t: number): CameraState {
  return {
    scale: Math.exp(Math.log(a.scale) + (Math.log(b.scale) - Math.log(a.scale)) * t),
    cx: a.cx + (b.cx - a.cx) * t,
    cy: a.cy + (b.cy - a.cy) * t,
  };
}

/** Độ dài lượt camera di chuyển, tuỳ quãng đường (đi xa thì lâu hơn, như người quay thật) */
export function moveDuration(a: CameraState, b: CameraState, W: number) {
  const dist = Math.abs(Math.log(b.scale / a.scale)) + Math.hypot(b.cx - a.cx, b.cy - a.cy) / W;
  return Math.round(clamp(20 + dist * 22, 22, 42));
}

/** Phép biến đổi (translate + scale, gốc 0,0) để tâm camera nằm giữa khung, không lộ mép ảnh. */
export function cameraTransform(cam: CameraState, W: number, H: number) {
  const s = Math.max(1, cam.scale);
  const tx = clamp(W / 2 - s * cam.cx, W - s * W, 0);
  const ty = clamp(H / 2 - s * cam.cy, H - s * H, 0);
  return { s, tx, ty };
}

export function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

/** Số giả ngẫu nhiên ổn định theo chuỗi (dùng cho nhịp chớp mắt, lệch pha) */
export function hashOf(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967295;
}

/** Thân nhân vật trong toạ độ khung hình (trước khi zoom): khung ảnh chừa chỗ giơ tay nên chỉ lấy phần giữa */
export function bodyRect(p: Placed, ch: { width: number; height: number; headTop: number }): Rect {
  const spriteH = p.bodyH / Math.max(0.3, 1 - ch.headTop);
  const half = (ch.width / ch.height) * spriteH * 0.36;
  return { x1: p.x - half, y1: p.head - p.bodyH * 0.03, x2: p.x + half, y2: p.feet };
}

export function toScreenRect(r: Rect, t: { s: number; tx: number; ty: number }): Rect {
  return { x1: t.tx + t.s * r.x1, y1: t.ty + t.s * r.y1, x2: t.tx + t.s * r.x2, y2: t.ty + t.s * r.y2 };
}

export function overlapArea(a: Rect, b: Rect) {
  return Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1)) * Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
}

export const rectAt = (cx: number, cy: number, w: number, h: number): Rect => ({
  x1: cx - w / 2,
  y1: cy - h / 2,
  x2: cx + w / 2,
  y2: cy + h / 2,
});

/**
 * Chọn tâm cho một khối chữ/hình (w × h): gần vị trí mong muốn nhất mà nằm trọn trong `bounds` và không đè lên
 * vùng cần tránh (nhân vật, nhãn khác). Không có chỗ trống hoàn toàn thì lấy chỗ đè ít nhất.
 */
export function placeRect(w: number, h: number, prefer: { x: number; y: number }, avoid: Rect[], bounds: Rect) {
  const fit = (x: number, y: number) => ({
    x: clamp(x, bounds.x1 + w / 2, Math.max(bounds.x1 + w / 2, bounds.x2 - w / 2)),
    y: clamp(y, bounds.y1 + h / 2, Math.max(bounds.y1 + h / 2, bounds.y2 - h / 2)),
  });
  const cost = (c: { x: number; y: number }) => {
    const r = rectAt(c.x, c.y, w + 24, h + 24);
    return avoid.reduce((sum, a) => sum + overlapArea(r, a), 0);
  };
  let best = fit(prefer.x, prefer.y);
  let bestCost = cost(best);
  if (bestCost === 0) return best;
  const step = Math.max(40, Math.min(w, h) / 3);
  for (let ring = 1; ring <= 24; ring++) {
    const n = 8 + ring * 4;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 - Math.PI / 2; // bắt đầu từ phía trên
      const c = fit(prefer.x + Math.cos(a) * ring * step, prefer.y + Math.sin(a) * ring * step);
      const v = cost(c);
      if (v < bestCost) {
        best = c;
        bestCost = v;
        if (v === 0) return best;
      }
    }
  }
  return best;
}
