import React from 'react';
import { AbsoluteFill, Audio, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { INTRO_AUDIO_OFFSET, type RenderCharacter, type RenderIntro, type RenderShot } from '@edu/shared';
import { rigState } from '../acting';
import { COLORS, FONT_FAMILY } from '../theme';
import { CharacterRig } from './CharacterRig';
import { Clouds } from './Clouds';

export const Intro: React.FC<{ intro: RenderIntro; host: RenderCharacter | null }> = ({ intro, host }) => {
  const frame = useCurrentFrame();
  const { fps, width: W, height: H } = useVideoConfig();

  const titleIn = spring({ frame: frame - 6, fps, config: { damping: 9, stiffness: 120 } });
  const subIn = interpolate(frame, [22, 36], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const hostIn = spring({ frame: frame - 12, fps, config: { damping: 13 } });
  // Người dẫn chào (giơ tay reo) rồi nói tiếp
  const hostShot = {
    speaker: host?.id ?? '',
    audioOffset: INTRO_AUDIO_OFFSET,
    audioFrames: intro.mouth.length,
    mouth: intro.mouth,
    level: intro.level,
    action: 'cheer',
    reaction: 'none',
  } as unknown as RenderShot;
  const ctx = (f: number) => ({ id: host?.id ?? '', shot: hostShot, local: f, frame: f, lookX: 0, x: W * 0.8 });
  // Mascot chính diện dang tay có khung ảnh rộng gần gấp đôi nhân vật thường: thu nhỏ lại và dồn tiêu đề sang trái
  // để không che chữ. Nhân vật thường (khung rộng dưới 0.3W) giữ nguyên bố cục.
  const lift = host ? Math.max(0.3, 1 - host.headTop) : 1;
  const aspect = host ? host.width / host.height : 0;
  const hostHeight = host ? Math.min(H * 0.8, (W * 0.36 * lift) / aspect) : 0;
  const extra = host ? Math.max(0, (aspect * hostHeight) / lift - W * 0.3) : 0;

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(180deg, ${COLORS.skyTop} 0%, ${COLORS.skyBottom} 100%)`,
      }}
    >
      <Clouds />
      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', paddingRight: host ? W * 0.18 + extra * 2 : 0 }}>
        <div
          style={{
            fontFamily: FONT_FAMILY,
            fontWeight: 800,
            fontSize: intro.title.length > 28 ? 110 : 150,
            color: COLORS.title,
            WebkitTextStroke: `10px ${COLORS.titleStroke}`,
            paintOrder: 'stroke fill',
            textShadow: '0 12px 0 rgba(0,0,0,0.12)',
            textAlign: 'center',
            maxWidth: W * 0.62 - extra,
            lineHeight: 1.1,
            textWrap: 'balance',
            transform: `scale(${titleIn})`,
          }}
        >
          {intro.title}
        </div>
        <div
          style={{
            marginTop: 30,
            fontFamily: FONT_FAMILY,
            fontWeight: 700,
            fontSize: 56,
            color: '#1c4a7a',
            background: 'rgba(255,255,255,0.8)',
            padding: '8px 36px',
            borderRadius: 40,
            opacity: subIn,
            transform: `translateY(${(1 - subIn) * 30}px)`,
          }}
        >
          {intro.subtitle}
        </div>
      </AbsoluteFill>
      {host ? (
        <div style={{ position: 'absolute', inset: 0, transform: `translateX(${(1 - hostIn) * 700}px)` }}>
          <CharacterRig
            character={host}
            x={W * 0.8}
            feet={H * 1.03}
            bodyHeight={hostHeight}
            frame={frame}
            phase={0}
            state={rigState(ctx(frame), (k) => ctx(Math.max(0, frame - k)))}
          />
        </div>
      ) : null}
      {intro.audioSrc ? (
        <Sequence from={INTRO_AUDIO_OFFSET}>
          <Audio src={intro.audioSrc} />
        </Sequence>
      ) : null}
    </AbsoluteFill>
  );
};
