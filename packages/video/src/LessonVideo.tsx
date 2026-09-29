import React, { useMemo } from 'react';
import { AbsoluteFill, Audio, Sequence, interpolate } from 'remotion';
import type { LessonRenderProps } from '@edu/shared';
import { Intro } from './components/Intro';
import { Outro } from './components/Outro';
import { Scene } from './components/Scene';
import { FONT_FAMILY } from './theme';

/** Frame giảm nhạc trước khi nhân vật nói / trả lại sau khi nói xong */
const DUCK_ATTACK = 8;
const DUCK_RELEASE = 18;

export const LessonVideo: React.FC<LessonRenderProps> = (props) => {
  const host = (id: string | null) => (id ? (props.characters[id] ?? null) : null);

  const musicVolume = useMemo(() => {
    const music = props.music;
    if (!music) return () => 0;
    const intervals = [...props.voiceIntervals].sort((a, b) => a[0] - b[0]);
    const total = props.durationInFrames;
    return (f: number) => {
      // Mức "có lời" 0..1, có đoạn dốc trước/sau để nhạc lên xuống mượt
      let speech = 0;
      for (const [a, b] of intervals) {
        if (a - DUCK_ATTACK > f) break;
        if (f >= a && f <= b) {
          speech = 1;
          break;
        }
        if (f < a) speech = Math.max(speech, 1 - (a - f) / DUCK_ATTACK);
        else if (f - b < DUCK_RELEASE) speech = Math.max(speech, 1 - (f - b) / DUCK_RELEASE);
      }
      const duck = 1 - (1 - music.duckLevel) * speech;
      const fade = interpolate(f, [0, 30, total - 45, total], [0, 1, 1, 0], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      });
      return music.volume * duck * fade;
    };
  }, [props.music, props.voiceIntervals, props.durationInFrames]);

  return (
    <AbsoluteFill style={{ background: '#000', fontFamily: FONT_FAMILY }}>
      <Sequence durationInFrames={props.intro.durationInFrames} name="Intro">
        <Intro intro={props.intro} host={host(props.intro.hostId)} />
      </Sequence>
      {props.scenes.map((scene, i) => (
        <Sequence key={i} from={scene.from} durationInFrames={scene.durationInFrames} name={`Cảnh ${i + 1}`}>
          <Scene scene={scene} characters={props.characters} burnSubtitles={props.burnSubtitles} />
        </Sequence>
      ))}
      <Sequence from={props.outro.from} durationInFrames={props.outro.durationInFrames} name="Outro">
        <Outro outro={props.outro} host={host(props.outro.hostId)} />
      </Sequence>

      {props.sfx.map((cue, i) => (
        <Sequence key={`sfx-${i}`} from={cue.from} durationInFrames={props.fps * 3} name="SFX">
          <Audio src={cue.src} volume={cue.volume} playbackRate={cue.playbackRate} />
        </Sequence>
      ))}
      {props.music ? <Audio src={props.music.src} loop loopVolumeCurveBehavior="extend" volume={musicVolume} name="Nhạc nền" /> : null}
    </AbsoluteFill>
  );
};
