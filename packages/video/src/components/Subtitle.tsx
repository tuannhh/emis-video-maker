import React from 'react';
import { interpolate } from 'remotion';
import { COLORS, FONT_FAMILY } from '../theme';

export const Subtitle: React.FC<{ text: string; speaker?: string; localFrame: number }> = ({
  text,
  speaker,
  localFrame,
}) => {
  const opacity = interpolate(localFrame, [0, 6], [0, 1], { extrapolateRight: 'clamp' });
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 48,
        display: 'flex',
        justifyContent: 'center',
        opacity,
      }}
    >
      <div
        style={{
          maxWidth: '78%',
          padding: '14px 32px',
          borderRadius: 24,
          background: COLORS.subtitleBg,
          color: COLORS.subtitleText,
          fontFamily: FONT_FAMILY,
          fontWeight: 700,
          fontSize: 50,
          lineHeight: 1.25,
          textAlign: 'center',
        }}
      >
        {speaker ? (
          <span style={{ color: '#ffd43b', marginRight: 14 }}>{speaker}:</span>
        ) : null}
        {text}
      </div>
    </div>
  );
};
