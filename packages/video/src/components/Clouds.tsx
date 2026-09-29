import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';

const CLOUDS = [
  { x: 0.08, y: 0.12, s: 1.2, v: 0.35 },
  { x: 0.62, y: 0.08, s: 1.6, v: 0.25 },
  { x: 0.35, y: 0.3, s: 0.9, v: 0.45 },
  { x: 0.82, y: 0.38, s: 1.1, v: 0.3 },
  { x: 0.15, y: 0.62, s: 1.4, v: 0.2 },
];

const Cloud: React.FC<{ scale: number }> = ({ scale }) => (
  <div style={{ position: 'relative', width: 260 * scale, height: 110 * scale }}>
    {[
      { l: 0, t: 40, w: 120, h: 70 },
      { l: 60, t: 0, w: 130, h: 110 },
      { l: 150, t: 30, w: 110, h: 80 },
    ].map((p, i) => (
      <div
        key={i}
        style={{
          position: 'absolute',
          left: p.l * scale,
          top: p.t * scale,
          width: p.w * scale,
          height: p.h * scale,
          borderRadius: '50%',
          background: 'white',
          boxShadow: `0 ${8 * scale}px 0 rgba(160, 200, 230, 0.45)`,
        }}
      />
    ))}
  </div>
);

export const Clouds: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  return (
    <>
      {CLOUDS.map((c, i) => {
        const x = ((c.x * width + frame * c.v * 2) % (width + 400)) - 200;
        return (
          <div key={i} style={{ position: 'absolute', left: x, top: c.y * height }}>
            <Cloud scale={c.s} />
          </div>
        );
      })}
    </>
  );
};
