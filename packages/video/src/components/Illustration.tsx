import React from 'react';
import { Img, interpolate, spring, useVideoConfig } from 'remotion';
import type { RenderShot } from '@edu/shared';
import { COLORS, FONT_FAMILY } from '../theme';

type Ill = NonNullable<RenderShot['illustration']>;

/** Cạnh lớn nhất của hình và chiều cao dòng chú thích trong thẻ minh hoạ (pixel 1080p) */
export const ILLUSTRATION_IMAGE = 300;
const CAPTION_H = 64;
const PAD = 18;
const GAP = 10;

/** Lưới khi đếm vật: tối đa 5 cột, ô nhỏ dần khi nhiều vật */
function grid(ill: Ill) {
  const n = Math.max(1, ill.count);
  if (n === 1) return { cols: 1, rows: 1, cell: ILLUSTRATION_IMAGE };
  const cols = n <= 5 ? n : Math.ceil(n / 2);
  return { cols, rows: Math.ceil(n / cols), cell: n <= 3 ? 190 : n <= 5 ? 150 : 128 };
}

export function illustrationSize(ill: Ill) {
  const { cols, rows, cell } = grid(ill);
  const k = cell / Math.max(ill.width, ill.height);
  const itemW = ill.count > 1 ? cell : ill.width * k;
  const itemH = ill.count > 1 ? cell : ill.height * k;
  // Thẻ đủ rộng cho cả chú thích để chữ không bị cắt
  const captionW = [...ill.caption].length * 44 * 0.56;
  const imgW = cols * itemW + (cols - 1) * GAP;
  const imgH = rows * itemH + (rows - 1) * GAP;
  return { w: Math.max(imgW, 200, captionW) + PAD * 2, h: imgH + CAPTION_H + PAD * 2, imgH };
}

/**
 * Thẻ hình minh hoạ bật ra cạnh nhân vật khi lời thoại nhắc tới sự vật, nhấp nhô nhẹ, mờ dần cuối shot.
 * Khi đếm (count > 1): hình một vật được nhân đúng số lượng, từng cái bật ra kèm số theo nhịp đếm.
 */
export const Illustration: React.FC<{
  ill: Ill;
  at: { x: number; y: number };
  local: number;
  duration: number;
}> = ({ ill, at, local, duration }) => {
  const { fps } = useVideoConfig();
  if (local < ill.start) return null;
  const pop = spring({ frame: local - ill.start, fps, config: { damping: 11, stiffness: 150 } });
  const out = interpolate(local, [duration - 10, duration], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const bob = Math.sin(((local - ill.start) / fps) * Math.PI * 0.9) * 6;
  const tilt = (1 - pop) * -8;
  const { w, h, imgH } = illustrationSize(ill);
  const { cols, cell } = grid(ill);
  const counting = ill.count > 1;
  const last = ill.countStarts[ill.countStarts.length - 1] ?? ill.start;
  // Đếm xong mới hiện chú thích tổng ("6 cây bút chì")
  const captionIn = counting
    ? interpolate(local, [last + 4, last + 12], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
    : 1;

  return (
    <div
      style={{
        position: 'absolute',
        left: at.x - w / 2,
        top: at.y - h / 2 + bob,
        width: w,
        height: h,
        padding: PAD,
        boxSizing: 'border-box',
        borderRadius: 32,
        background: COLORS.cardBg,
        border: `6px solid ${COLORS.badgeBorder}`,
        boxShadow: '0 14px 30px rgba(0,0,0,0.18)',
        opacity: out,
        transform: `scale(${pop}) rotate(${tilt}deg)`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
    >
      {counting ? (
        <div
          style={{
            height: imgH,
            display: 'grid',
            gridTemplateColumns: `repeat(${cols}, ${cell}px)`,
            gridAutoRows: cell,
            gap: GAP,
            justifyContent: 'center',
          }}
        >
          {Array.from({ length: ill.count }, (_, i) => {
            const start = ill.countStarts[i] ?? ill.start;
            const p = local < start ? 0 : spring({ frame: local - start, fps, config: { damping: 10, stiffness: 170 } });
            return (
              <div key={i} style={{ position: 'relative', width: cell, height: cell, transform: `scale(${p})` }}>
                <Img src={ill.src} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                <div
                  style={{
                    position: 'absolute',
                    right: -4,
                    top: -4,
                    minWidth: 40,
                    height: 40,
                    borderRadius: 20,
                    background: COLORS.badgeBg,
                    border: `4px solid ${COLORS.badgeBorder}`,
                    color: COLORS.badgeText,
                    fontFamily: FONT_FAMILY,
                    fontWeight: 800,
                    fontSize: 26,
                    lineHeight: '32px',
                    textAlign: 'center',
                    boxSizing: 'border-box',
                  }}
                >
                  {i + 1}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <Img src={ill.src} style={{ height: imgH, width: '100%', objectFit: 'contain' }} />
      )}
      <div
        style={{
          height: CAPTION_H,
          display: 'flex',
          alignItems: 'center',
          fontFamily: FONT_FAMILY,
          fontWeight: 800,
          fontSize: 44,
          color: COLORS.badgeText,
          whiteSpace: 'nowrap',
          opacity: captionIn,
        }}
      >
        {ill.caption}
      </div>
    </div>
  );
};
