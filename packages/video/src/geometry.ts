import type { Box, Framing, RenderSceneCharacter } from '@edu/shared';

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
}

export function placeCharacter(c: RenderSceneCharacter, layout: CoverLayout): Placed {
  const x = layout.left + c.x * layout.width;
  const feet = layout.top + c.feetY * layout.height;
  const bodyH = c.bodyHeight * layout.height;
  return { id: c.id, x, feet, bodyH, head: feet - bodyH };
}

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
    const h = s.bodyH * (close ? 0.44 : 0.72);
    const top = s.head - s.bodyH * (close ? 0.07 : 0.09);
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
    const y2 = Math.min(s.head, other.head) + bodyH * 0.85;
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
