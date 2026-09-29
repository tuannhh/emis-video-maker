import React from 'react';
import { interpolate, spring, useVideoConfig } from 'remotion';
import type { RenderShot } from '@edu/shared';
import { boxToFrame, clamp, type CoverLayout } from '../geometry';
import { COLORS, FONT_FAMILY } from '../theme';

interface Props {
  overlay: NonNullable<RenderShot['overlay']>;
  layout: CoverLayout;
  s: number;
  tx: number;
  ty: number;
  local: number;
}

/** Nhãn gắn lên vật thể: đi theo camera nhưng giữ kích thước dễ đọc trên màn hình. */
export const Overlay: React.FC<Props> = ({ overlay, layout, s, tx, ty, local }) => {
  const { fps } = useVideoConfig();
  const toScreen = (x: number, y: number) => ({ x: tx + s * x, y: ty + s * y });
  const rects = overlay.boxes.map((b) => boxToFrame(b, layout));
  if (!rects.length) return null;

  const union = rects.reduce((a, r) => ({
    x1: Math.min(a.x1, r.x1),
    y1: Math.min(a.y1, r.y1),
    x2: Math.max(a.x2, r.x2),
    y2: Math.max(a.y2, r.y2),
  }));
  const u1 = toScreen(union.x1, union.y1);
  const u2 = toScreen(union.x2, union.y2);
  const size = clamp(s, 1, 1.7);

  const badge = (text: string, start: number, cx: number, top: number, big: boolean, opacity = 1) => {
    const pop = spring({ frame: local - start, fps, config: { damping: 10, stiffness: 170 } });
    if (local < start) return null;
    return (
      <div
        key={`badge-${text}-${start}`}
        style={{
          position: 'absolute',
          left: cx,
          top,
          transform: `translate(-50%, -100%) scale(${pop})`,
          transformOrigin: '50% 100%',
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
    // Số từng vật mờ bớt khi hiện tổng; tổng đặt trên số cao nhất để không che nhau
    const dim = interpolate(local, [totalStart, totalStart + 10], [1, 0.45], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
    const smallBadgeH = 66 * size;
    const highest = Math.min(...rects.map((r) => toScreen(r.x1, r.y1 + (r.y2 - r.y1) * 0.3).y - smallBadgeH));
    return (
      <>
        {rects.map((r, i) => {
          const start = overlay.startFrames[i] ?? lastStart;
          if (local < start) return null;
          const a = toScreen(r.x1, r.y1);
          const b = toScreen(r.x2, r.y2);
          const flash = spring({ frame: local - start, fps, config: { damping: 14, stiffness: 120 } });
          return (
            <React.Fragment key={i}>
              {/* Vòng sáng lan ra khi đếm tới vật này */}
              <div
                style={{
                  position: 'absolute',
                  left: (a.x + b.x) / 2,
                  top: (a.y + b.y) / 2,
                  width: (b.x - a.x) * (1 + flash * 0.25),
                  height: (b.y - a.y) * (1 + flash * 0.25),
                  transform: 'translate(-50%, -50%)',
                  borderRadius: '50%',
                  border: `${5 * size}px solid ${COLORS.ring}`,
                  opacity: 1 - flash * 0.75,
                }}
              />
              {badge(String(i + 1), start, (a.x + b.x) / 2, a.y + (b.y - a.y) * 0.3, false, dim)}
            </React.Fragment>
          );
        })}
        {badge(overlay.text, totalStart, (u1.x + u2.x) / 2, Math.max(130, Math.min(u1.y - 30, highest - 10)), true)}
      </>
    );
  }

  const start = overlay.startFrames[0] ?? 8;
  const ring = spring({ frame: local - start, fps, config: { damping: 16 } });
  const pulse = 1 + Math.sin((local / fps) * Math.PI * 2) * 0.03;
  const w = u2.x - u1.x + 40;
  const h = u2.y - u1.y + 40;
  return (
    <>
      {local >= start ? (
        <div
          style={{
            position: 'absolute',
            left: (u1.x + u2.x) / 2 - w / 2,
            top: (u1.y + u2.y) / 2 - h / 2,
            width: w,
            height: h,
            borderRadius: '50%',
            border: `${7 * size}px dashed ${COLORS.ring}`,
            opacity: ring * 0.9,
            transform: `scale(${pulse * (0.85 + 0.15 * ring)})`,
          }}
        />
      ) : null}
      {badge(overlay.text, start, (u1.x + u2.x) / 2, Math.max(130, u1.y - 24), true)}
    </>
  );
};
