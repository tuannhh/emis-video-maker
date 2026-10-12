import React from 'react';
import { interpolate, spring, useVideoConfig } from 'remotion';
import type { RenderShot } from '@edu/shared';
import { boxToFrame, clamp, type CoverLayout, type Rect } from '../geometry';
import { COLORS, FONT_FAMILY } from '../theme';

/** Kích thước ước lượng của thẻ chữ (để xếp chỗ trước khi vẽ) */
export function badgeSize(text: string, big: boolean, size: number) {
  const font = (big ? 84 : 46) * size;
  const padX = (big ? 26 : 12) * size;
  const border = (big ? 7 : 5) * size;
  const textW = [...text].length * font * 0.58;
  return {
    w: Math.max((big ? 120 : 64) * size, textW + 2 * (padX + border)),
    h: font * 1.1 + 2 * ((big ? 4 : 2) * size + border),
  };
}

/** Cỡ chữ của nhãn theo mức zoom camera */
export const badgeScale = (s: number) => clamp(s, 1, 1.7);

interface Props {
  overlay: NonNullable<RenderShot['overlay']>;
  layout: CoverLayout;
  s: number;
  tx: number;
  ty: number;
  local: number;
  /** Vùng nhân vật trên màn hình: số đếm rơi vào đây thì không vẽ (tránh chữ đè lên người) */
  avoid: Rect[];
  /** Tâm thẻ lớn (tổng số / nhãn) trên màn hình, đã xếp chỗ tránh nhân vật và nằm trọn trong khung */
  badgeAt: { x: number; y: number };
  /** Nhãn: vật nằm trong khung và không bị che thì khoanh vòng quanh vật */
  ring: boolean;
}

/** Nhãn gắn lên vật thể: số đếm đi theo camera, thẻ lớn đặt ở chỗ trống, giữ kích thước dễ đọc trên màn hình. */
export const Overlay: React.FC<Props> = ({ overlay, layout, s, tx, ty, local, avoid, badgeAt, ring }) => {
  const { fps } = useVideoConfig();
  const toScreen = (x: number, y: number) => ({ x: tx + s * x, y: ty + s * y });
  const rects = overlay.boxes.map((b) => boxToFrame(b, layout));
  if (!rects.length) return null;
  const size = badgeScale(s);
  const hidden = (x: number, y: number) => avoid.some((a) => x > a.x1 && x < a.x2 && y > a.y1 && y < a.y2);

  const badge = (text: string, start: number, cx: number, cy: number, big: boolean, opacity = 1) => {
    const pop = spring({ frame: local - start, fps, config: { damping: 10, stiffness: 170 } });
    if (local < start) return null;
    return (
      <div
        key={`badge-${text}-${start}`}
        style={{
          position: 'absolute',
          left: cx,
          top: cy,
          transform: `translate(-50%, -50%) scale(${pop})`,
          opacity,
          minWidth: (big ? 120 : 64) * size,
          padding: big ? `${4 * size}px ${26 * size}px` : `${2 * size}px ${12 * size}px`,
          borderRadius: (big ? 28 : 40) * size,
          background: COLORS.badgeBg,
          border: `${(big ? 7 : 5) * size}px solid ${COLORS.badgeBorder}`,
          color: COLORS.badgeText,
          fontFamily: FONT_FAMILY,
          fontWeight: 800,
          fontSize: (big ? 84 : 46) * size,
          lineHeight: 1.1,
          textAlign: 'center',
          whiteSpace: 'nowrap',
          boxShadow: '0 8px 0 rgba(0,0,0,0.16)',
        }}
      >
        {text}
      </div>
    );
  };

  if (overlay.kind === 'count') {
    const lastStart = overlay.startFrames[overlay.startFrames.length - 1] ?? 0;
    const totalStart = lastStart + 12;
    // Số từng vật mờ bớt khi hiện tổng
    const dim = interpolate(local, [totalStart, totalStart + 10], [1, 0.45], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
    const small = badgeSize('10', false, size);
    return (
      <>
        {rects.map((r, i) => {
          const start = overlay.startFrames[i] ?? lastStart;
          if (local < start) return null;
          const a = toScreen(r.x1, r.y1);
          const b = toScreen(r.x2, r.y2);
          const cx = (a.x + b.x) / 2;
          // Số đặt trên vật một chút; vật bị nhân vật che thì không đánh số đè lên người
          const cy = a.y + (b.y - a.y) * 0.3 - small.h / 2;
          if (hidden(cx, (a.y + b.y) / 2) || hidden(cx, cy)) return null;
          const flash = spring({ frame: local - start, fps, config: { damping: 14, stiffness: 120 } });
          return (
            <React.Fragment key={i}>
              {/* Vòng sáng lan ra khi đếm tới vật này */}
              <div
                style={{
                  position: 'absolute',
                  left: cx,
                  top: (a.y + b.y) / 2,
                  width: (b.x - a.x) * (1 + flash * 0.25),
                  height: (b.y - a.y) * (1 + flash * 0.25),
                  transform: 'translate(-50%, -50%)',
                  borderRadius: '50%',
                  border: `${5 * size}px solid ${COLORS.ring}`,
                  opacity: 1 - flash * 0.75,
                }}
              />
              {badge(String(i + 1), start, cx, cy, false, dim)}
            </React.Fragment>
          );
        })}
        {badge(overlay.text, totalStart, badgeAt.x, badgeAt.y, true)}
      </>
    );
  }

  const start = overlay.startFrames[0] ?? 8;
  const grow = spring({ frame: local - start, fps, config: { damping: 16 } });
  const pulse = 1 + Math.sin((local / fps) * Math.PI * 2) * 0.03;
  const u1 = toScreen(Math.min(...rects.map((r) => r.x1)), Math.min(...rects.map((r) => r.y1)));
  const u2 = toScreen(Math.max(...rects.map((r) => r.x2)), Math.max(...rects.map((r) => r.y2)));
  const w = u2.x - u1.x + 40;
  const h = u2.y - u1.y + 40;
  return (
    <>
      {ring && local >= start ? (
        <div
          style={{
            position: 'absolute',
            left: (u1.x + u2.x) / 2 - w / 2,
            top: (u1.y + u2.y) / 2 - h / 2,
            width: w,
            height: h,
            borderRadius: '50%',
            border: `${7 * size}px dashed ${COLORS.ring}`,
            opacity: grow * 0.9,
            transform: `scale(${pulse * (0.85 + 0.15 * grow)})`,
          }}
        />
      ) : null}
      {badge(overlay.text, start, badgeAt.x, badgeAt.y, true)}
    </>
  );
};
