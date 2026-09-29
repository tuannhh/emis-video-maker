import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import type { RenderCharacter, RenderOutro, RenderShot } from '@edu/shared';
import { rigState } from '../acting';
import { COLORS, FONT_FAMILY } from '../theme';
import { CharacterRig } from './CharacterRig';
import { Clouds } from './Clouds';

export const Outro: React.FC<{ outro: RenderOutro; host: RenderCharacter | null }> = ({ outro, host }) => {
  const frame = useCurrentFrame();
  const { fps, width: W, height: H } = useVideoConfig();
  const cardIn = spring({ frame, fps, config: { damping: 14 } });
  const fadeIn = interpolate(frame, [0, 14], [0, 1], { extrapolateRight: 'clamp' });
  // Người dẫn reo mừng khi tổng kết rồi đứng nhìn thẻ ghi nhớ
  const hostShot = {
    speaker: host?.id ?? '',
    audioOffset: 12,
    audioFrames: 48,
    mouth: '',
    level: '',
    action: 'cheer',
    reaction: 'none',
  } as unknown as RenderShot;
  const ctx = (f: number) => ({ id: host?.id ?? '', shot: hostShot, local: f, frame: f, lookX: 0, x: W * 0.82 });

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(180deg, ${COLORS.skyTop} 0%, ${COLORS.skyBottom} 100%)`,
        opacity: fadeIn,
      }}
    >
      <Clouds />
      <div
        style={{
          position: 'absolute',
          left: W * 0.07,
          top: H * 0.12,
          width: W * (host ? 0.58 : 0.86),
          padding: '48px 64px',
          borderRadius: 48,
          background: COLORS.cardBg,
          boxShadow: '0 20px 0 rgba(0,0,0,0.08)',
          transform: `scale(${cardIn})`,
          transformOrigin: '30% 30%',
          fontFamily: FONT_FAMILY,
        }}
      >
        <div style={{ fontSize: 84, fontWeight: 800, color: COLORS.title, marginBottom: 24 }}>
          {outro.heading}
        </div>
        {outro.points.map((p, i) => {
          const pIn = spring({ frame: frame - 18 - i * 22, fps, config: { damping: 15 } });
          return (
            <div
              key={i}
              style={{
                display: 'flex',
                gap: 24,
                alignItems: 'flex-start',
                fontSize: 50,
                fontWeight: 600,
                lineHeight: 1.3,
                color: '#1f2a44',
                marginBottom: 20,
                opacity: pIn,
                transform: `translateX(${(1 - pIn) * -60}px)`,
              }}
            >
              <span style={{ color: COLORS.accent, fontWeight: 800 }}>✔</span>
              <span>{p}</span>
            </div>
          );
        })}
      </div>
      {host ? (
        <CharacterRig
          character={host}
          x={W * 0.82}
          feet={H * 1.03}
          bodyHeight={H * 0.8}
          frame={frame}
          phase={1.3}
          state={rigState(ctx(frame), (k) => ctx(Math.max(0, frame - k)))}
        />
      ) : null}
    </AbsoluteFill>
  );
};
