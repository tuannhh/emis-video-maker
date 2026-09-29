import React, { useMemo } from 'react';
import { AbsoluteFill, Audio, Easing, Img, Sequence, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { TRANSITION_FRAMES, type RenderCharacter, type RenderScene, type RenderShot } from '@edu/shared';
import { activeShotIndex, rigState, type ActingContext } from '../acting';
import {
  applyMotion,
  boxToFrame,
  cameraTransform,
  coverLayout,
  framingCamera,
  hashOf,
  lerpCamera,
  moveDuration,
  placeCharacter,
  type CameraState,
  type Placed,
} from '../geometry';
import { CharacterRig } from './CharacterRig';
import { Overlay } from './Overlay';
import { Subtitle } from './Subtitle';

interface Props {
  scene: RenderScene;
  characters: Record<string, RenderCharacter>;
  burnSubtitles: boolean;
}

/** Nhịp chuyển camera: chậm dần ở cuối như tay quay phim thật, không giật cơ học */
const MOVE_EASE = Easing.bezier(0.45, 0, 0.15, 1);
const ENTER_EASE = Easing.bezier(0.33, 0, 0.2, 1);

/** Nhoè hậu cảnh (px trên ảnh nền) theo cỡ cảnh: tách nhân vật khỏi nền ở trung/cận cảnh */
const BLUR: Record<string, number> = { wide: 0, object: 0, 'two-shot': 0.8, medium: 2, 'close-up': 3 };

export const Scene: React.FC<Props> = ({ scene, characters, burnSubtitles }) => {
  const frame = useCurrentFrame();
  const { width: W, height: H } = useVideoConfig();
  const layout = coverLayout(scene.background.width, scene.background.height, W, H);

  const placed = useMemo(() => {
    const m = new Map<string, Placed>();
    for (const c of scene.characters) if (characters[c.id]) m.set(c.id, placeCharacter(c, layout));
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, characters, W, H]);

  /** Điểm (x) mà nhân vật `id` nhìn vào trong shot */
  const lookX = (id: string, shot: RenderShot): number | null => {
    const me = placed.get(id);
    if (!me) return null;
    const target = shot.targetBox ? boxToFrame(shot.targetBox, layout) : null;
    const tx = target ? (target.x1 + target.x2) / 2 : null;
    if (shot.speaker === id) {
      if (tx !== null && (shot.action === 'point' || shot.framing === 'object')) return tx;
      const l = shot.listener ? placed.get(shot.listener) : null;
      if (l) return l.x;
      const others = [...placed.values()].filter((p) => p.id !== id);
      return others.length ? others[0].x : W / 2;
    }
    const sp = placed.get(shot.speaker);
    if (sp) return sp.x;
    return tx ?? W / 2;
  };

  // Khung camera gốc của từng shot (tính một lần cho cả cảnh)
  const cams = useMemo(
    () =>
      scene.shots.map((shot) => {
        const speaker = placed.get(shot.speaker) ?? null;
        const listener = shot.listener ? (placed.get(shot.listener) ?? null) : null;
        const lx = lookX(shot.speaker, shot);
        const facing: 1 | -1 = speaker && lx !== null && lx < speaker.x ? -1 : 1;
        const target = shot.targetBox ? boxToFrame(shot.targetBox, layout) : null;
        return { base: framingCamera({ framing: shot.framing, speaker, listener, speakerFacing: facing, target }, W, H), facing };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scene, placed, W, H],
  );

  const idx = activeShotIndex(scene.shots, frame);
  const shot = scene.shots[idx];
  const local = frame - shot.from;

  const motionAt = (i: number, p: number): CameraState =>
    applyMotion(cams[i].base, scene.shots[i].motion, p, W, cams[i].facing);

  let cam = motionAt(idx, local / shot.durationInFrames);
  let blur = BLUR[shot.framing] ?? 0;
  if (idx > 0 && shot.transition === 'move') {
    const from = motionAt(idx - 1, 1);
    const dur = moveDuration(from, cams[idx].base, W);
    if (local < dur) {
      const t = MOVE_EASE(local / dur);
      cam = lerpCamera(from, cam, t);
      blur = (BLUR[scene.shots[idx - 1].framing] ?? 0) * (1 - t) + blur * t;
    }
  }
  const { s, tx, ty } = cameraTransform(cam, W, H);

  const ctxAt = (id: string, f: number): ActingContext => {
    const i = activeShotIndex(scene.shots, f);
    const sh = scene.shots[i];
    return { id, shot: sh, local: f - sh.from, frame: f, lookX: lookX(id, sh), x: placed.get(id)?.x ?? 0 };
  };

  // Chuyển cảnh vào
  const enter = interpolate(frame, [0, TRANSITION_FRAMES], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: ENTER_EASE,
  });
  const wrap: React.CSSProperties = { overflow: 'hidden', background: '#9fd8ff' };
  if (enter < 1) {
    if (scene.transition === 'iris') wrap.clipPath = `circle(${enter * Math.hypot(W / 2, H / 2) * 1.02}px at 50% 50%)`;
    else if (scene.transition === 'slide') wrap.transform = `translateX(${(1 - enter) * W}px)`;
    else if (scene.transition === 'dissolve') wrap.opacity = enter;
  }

  const speakerName = characters[shot.speaker]?.name;
  const audioLocal = local - shot.audioOffset;
  const showSubtitle = burnSubtitles && audioLocal >= 0 && audioLocal < shot.audioFrames + 12;

  return (
    <AbsoluteFill style={wrap}>
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: W,
          height: H,
          transformOrigin: '0 0',
          transform: `translate(${tx}px, ${ty}px) scale(${s})`,
        }}
      >
        {scene.background.src ? (
          <Img
            src={scene.background.src}
            style={{
              position: 'absolute',
              left: layout.left,
              top: layout.top,
              width: layout.width,
              height: layout.height,
              filter: blur > 0.05 ? `blur(${blur / s}px)` : undefined,
            }}
          />
        ) : null}
        {[...placed.values()]
          .sort((a, b) => a.feet - b.feet)
          .map((p) => (
            <CharacterRig
              key={p.id}
              character={characters[p.id]}
              x={p.x}
              feet={p.feet}
              bodyHeight={p.bodyH}
              frame={frame}
              phase={hashOf(p.id) * 10}
              state={rigState(ctxAt(p.id, frame), (k) => ctxAt(p.id, Math.max(0, frame - k)))}
            />
          ))}
      </div>

      {shot.overlay ? (
        <Overlay overlay={shot.overlay} layout={layout} s={s} tx={tx} ty={ty} local={local} />
      ) : null}

      {showSubtitle ? <Subtitle text={shot.text} speaker={speakerName} localFrame={audioLocal} /> : null}

      {scene.shots.map((sh, i) =>
        sh.audioSrc ? (
          <Sequence key={i} from={sh.from + sh.audioOffset} durationInFrames={sh.audioFrames + 6}>
            <Audio src={sh.audioSrc} />
          </Sequence>
        ) : null,
      )}
    </AbsoluteFill>
  );
};
