import React, { useMemo } from 'react';
import { AbsoluteFill, Audio, Easing, Img, Sequence, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { TRANSITION_FRAMES, type RenderCharacter, type RenderScene, type RenderShot } from '@edu/shared';
import { activeShotIndex, rigState, type ActingContext } from '../acting';
import {
  applyMotion,
  bodyRect,
  boxToFrame,
  cameraTransform,
  coverLayout,
  framingCamera,
  hashOf,
  lerpCamera,
  moveDuration,
  overlapArea,
  placeCharacter,
  placeRect,
  rectAt,
  toScreenRect,
  type CameraState,
  type Placed,
  type Rect,
} from '../geometry';
import { CharacterRig } from './CharacterRig';
import { Illustration, illustrationSize } from './Illustration';
import { Overlay, badgeScale, badgeSize } from './Overlay';
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
    for (const c of scene.characters) if (characters[c.id]) m.set(c.id, placeCharacter(c, layout, characters[c.id]));
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

  // Bố cục chữ/hình của từng shot (theo camera giữa shot): nằm trọn trong khung, không đè lên nhân vật
  const stages = useMemo(
    () =>
      scene.shots.map((sh, i) => {
        const t = cameraTransform(motionAt(i, 0.5), W, H);
        const avoid: Rect[] = [];
        for (const p of placed.values()) avoid.push(toScreenRect(bodyRect(p, characters[p.id]), t));
        const bounds: Rect = { x1: 24, y1: 24, x2: W - 24, y2: H - (burnSubtitles ? 200 : 32) };
        const taken = [...avoid];

        let badgeAt = { x: W / 2, y: H * 0.2 };
        let ring = false;
        if (sh.overlay && sh.overlay.boxes.length) {
          const rs = sh.overlay.boxes.map((b) => toScreenRect(boxToFrame(b, layout), t));
          const u: Rect = {
            x1: Math.min(...rs.map((r) => r.x1)),
            y1: Math.min(...rs.map((r) => r.y1)),
            x2: Math.max(...rs.map((r) => r.x2)),
            y2: Math.max(...rs.map((r) => r.y2)),
          };
          const area = Math.max(1, (u.x2 - u.x1) * (u.y2 - u.y1));
          const visible = overlapArea(u, { x1: 0, y1: 0, x2: W, y2: H }) / area;
          const cx = (u.x1 + u.x2) / 2;
          const cy = (u.y1 + u.y2) / 2;
          const covered = avoid.some((a) => cx > a.x1 && cx < a.x2 && cy > a.y1 && cy < a.y2);
          ring = sh.overlay.kind === 'label' && visible >= 0.6 && !covered;
          const size = badgeSize(sh.overlay.text, true, badgeScale(t.s));
          // Ưu tiên ngay phía trên vật; vật ra ngoài khung thì lấy chỗ gần vật nhất trong khung
          const prefer = { x: cx, y: u.y1 - size.h / 2 - 16 };
          // Số đếm từng vật cũng là vùng cần tránh của thẻ tổng
          const avoidBadge = sh.overlay.kind === 'count' ? [...avoid, ...rs] : [...avoid, u];
          badgeAt = placeRect(size.w, size.h, prefer, avoidBadge, bounds);
          taken.push(rectAt(badgeAt.x, badgeAt.y, size.w, size.h), u);
        }

        let illAt = { x: W / 2, y: H / 2 };
        if (sh.illustrations.length) {
          const size = illustrationSize(sh.illustrations);
          const sp = placed.get(sh.speaker);
          const spX = sp ? t.tx + t.s * sp.x : W / 2;
          // Hình hiện ở phía đối diện người nói (chỗ trống trong khung), cao ngang ngực
          const prefer = { x: spX > W / 2 ? W * 0.27 : W * 0.73, y: H * 0.38 };
          illAt = placeRect(size.w, size.h, prefer, taken, bounds);
        }
        return { avoid, badgeAt, ring, illAt };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scene, placed, characters, W, H, burnSubtitles],
  );
  const stage = stages[idx];

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
        <Overlay
          overlay={shot.overlay}
          layout={layout}
          s={s}
          tx={tx}
          ty={ty}
          local={local}
          avoid={stage.avoid}
          badgeAt={stage.badgeAt}
          ring={stage.ring}
        />
      ) : null}

      {shot.illustrations.length ? (
        <Illustration items={shot.illustrations} at={stage.illAt} local={local} duration={shot.durationInFrames} />
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
