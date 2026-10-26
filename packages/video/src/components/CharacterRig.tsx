import React, { createContext, useContext } from 'react';
import { Img, useVideoConfig } from 'remotion';
import type { Expression, Pose, RenderCharacter } from '@edu/shared';
import { EXPRESSIONS, POSES } from '@edu/shared';
import { POSE_BLEND } from '../acting';

/** Hệ số chuyển động của cả video (0.5 nhẹ nhàng, 1 vừa phải, 1.6 sinh động) */
export const MotionContext = createContext(1);

export interface RigState {
  pose: Pose;
  /** Dáng ngay trước lần đổi gần nhất (để hoà chuyển) */
  prevPose: Pose;
  /** Số frame kể từ lần đổi dáng gần nhất (lớn = đã lâu) */
  poseAgo: number;
  mouthOpen: boolean;
  /** Nhìn sang trái (lật ảnh) */
  flip: boolean;
  /** Số frame kể từ lần quay người gần nhất */
  turnAgo: number;
  blink: boolean;
  /** Tiến độ nhảy 0..1, hoặc -1 nếu không nhảy */
  hop: number;
  /** Biểu cảm vùng mắt đang hiện và độ đậm (hiện dần / tắt dần) */
  expression: Expression | null;
  exprAlpha: number;
  /** Tiến độ gật đầu 0..1, hoặc -1 */
  nod: number;
  /** Đang nói (kể cả nhịp lấy hơi ngay trước/sau câu) và độ lớn giọng 0..1 */
  speaking: boolean;
  level: number;
  /** Đang nghe người khác nói (hơi nghiêng về phía người nói) */
  listening: boolean;
}

interface Props {
  character: RenderCharacter;
  /** Toạ độ chân (pixel, trong hệ toạ độ của phần tử cha) */
  x: number;
  feet: number;
  /** Chiều cao người, đỉnh đầu → chân */
  bodyHeight: number;
  state: RigState;
  frame: number;
  phase: number;
}

// Quay người: co ngang rồi lật
const TURN_SQUASH = [0.55, 0.75, 0.9, 0.97];

const layer: React.CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%' };

/**
 * Nhân vật diễn như diễn viên thật: tay đổi cử chỉ, miệng nhép, mắt chớp và đổi biểu cảm theo cảm xúc câu thoại.
 * Cả người (mọi lớp ảnh cùng lúc, nên không lệch nhau) thở nhẹ, lắc lư theo nhịp nói, gật đầu khi đồng ý, hơi
 * nghiêng về phía người đang nói; nhảy lên khi reo mừng và quay người về phía người nói.
 */
export const CharacterRig: React.FC<Props> = ({ character: ch, x, feet, bodyHeight, state, frame, phase }) => {
  const motion = useContext(MotionContext);
  const { fps } = useVideoConfig();
  const spriteH = bodyHeight / Math.max(0.3, 1 - ch.headTop);
  const spriteW = (ch.width / ch.height) * spriteH;

  let scaleY = 1;
  let lift = 0;
  if (state.hop >= 0) {
    // Nhún lấy đà → bật lên → tiếp đất
    const p = state.hop;
    if (p < 0.18) {
      scaleY = 1 - 0.06 * Math.sin((p / 0.18) * Math.PI);
    } else if (p < 0.82) {
      lift = Math.sin(((p - 0.18) / 0.64) * Math.PI) * bodyHeight * 0.09;
    } else {
      scaleY = 1 - 0.05 * Math.sin(((p - 0.82) / 0.18) * Math.PI);
    }
  }
  const t = frame / fps;
  // Thở: phồng nhẹ theo chiều dọc, chu kỳ ~3,4 giây
  const breath = Math.sin((2 * Math.PI * t) / 3.4 + phase);
  scaleY *= 1 + 0.007 * motion * breath;
  // Gật đầu (người nghe): hai nhịp nhún nhẹ
  if (state.nod >= 0) scaleY *= 1 - 0.022 * motion * Math.abs(Math.sin(state.nod * 2 * Math.PI));
  // Nói thì nhún theo độ lớn giọng
  if (state.speaking) lift += state.level * bodyHeight * 0.006 * motion;
  const scaleX = 1 / Math.sqrt(scaleY);
  const turn = state.turnAgo < TURN_SQUASH.length ? TURN_SQUASH[state.turnAgo] : 1;
  const dir = ch.facing === 'front' ? 1 : state.flip ? -1 : 1;
  // Lắc lư quanh bàn chân: rất nhẹ khi đứng, rõ hơn khi nói; người nghe hơi nghiêng về phía người nói
  const sway =
    0.35 * Math.sin((2 * Math.PI * t) / 5.1 + phase) +
    (state.speaking ? (0.5 + state.level) * 0.9 * Math.sin((2 * Math.PI * t) / 1.7 + phase * 2) : 0) +
    (state.listening && ch.facing !== 'front' ? 0.7 * dir : 0) +
    (state.nod >= 0 ? 1.2 * dir * Math.sin(state.nod * Math.PI) : 0);
  const rotate = sway * motion;

  // Hoà hai dáng trong vài frame: đầu/thân trùng nhau nên chỉ thấy tay chuyển động
  const blend = ch.layered && state.poseAgo < POSE_BLEND ? (state.poseAgo + 1) / (POSE_BLEND + 1) : 1;
  const imgOf = (p: Pose, open: boolean) => {
    const set = ch.poses[p] ?? ch.poses.idle;
    return open && !ch.layered ? set.open : set.closed;
  };
  let current = imgOf(state.pose, state.mouthOpen);
  // Bộ dáng cũ: chớp mắt là ảnh nguyên người, chỉ dùng khi đứng yên, miệng khép
  if (!ch.layered && state.blink && state.pose === 'idle' && !state.mouthOpen && ch.blink) current = ch.blink;
  const before = imgOf(state.prevPose, false);
  const previous = blend < 1 && before !== current ? before : null;
  const alpha = previous ? blend : 1;

  const all = new Set<string>();
  for (const p of POSES) {
    all.add(ch.poses[p].closed);
    if (!ch.layered) all.add(ch.poses[p].open);
  }
  if (ch.blink && !ch.layered) all.add(ch.blink);

  const shadowScale = 1 - (lift / (bodyHeight * 0.09)) * 0.35;
  const expressions = EXPRESSIONS.filter((e) => ch.expressions?.[e]);

  return (
    <div style={{ position: 'absolute', left: x, top: feet, width: 0, height: 0 }}>
      {/* Bóng tiếp đất: giúp nhân vật "đứng" trên sàn thay vì trôi nổi */}
      <div
        style={{
          position: 'absolute',
          left: -bodyHeight * 0.17 * shadowScale,
          top: -bodyHeight * 0.018,
          width: bodyHeight * 0.34 * shadowScale,
          height: bodyHeight * 0.045,
          borderRadius: '50%',
          background: 'radial-gradient(closest-side, rgba(40,30,20,0.34), rgba(40,30,20,0))',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: -ch.bodyCx * spriteW,
          top: -spriteH - lift,
          width: spriteW,
          height: spriteH,
          transformOrigin: `${ch.bodyCx * 100}% 100%`,
          transform: `rotate(${rotate}deg) scaleX(${dir * scaleX * turn}) scaleY(${scaleY})`,
        }}
      >
        {/* Mọi ảnh luôn được gắn sẵn để đổi dáng không phải chờ tải */}
        {[...all].map((s) => (
          <Img
            key={s}
            src={s}
            style={{ ...layer, opacity: s === current ? alpha : s === previous ? 1 : 0, zIndex: s === current ? 2 : 1 }}
          />
        ))}
        {ch.layered && ch.mouth ? <Img src={ch.mouth} style={{ ...layer, zIndex: 3, opacity: state.mouthOpen ? 1 : 0 }} /> : null}
        {/* Biểu cảm vùng mắt: luôn gắn sẵn (ẩn) để đổi biểu cảm không phải chờ tải */}
        {ch.layered
          ? expressions.map((e) => (
              <Img
                key={e}
                src={ch.expressions[e]!}
                style={{ ...layer, zIndex: 4, opacity: state.expression === e ? state.exprAlpha : 0 }}
              />
            ))
          : null}
        {ch.layered && ch.blink ? (
          <Img src={ch.blink} style={{ ...layer, zIndex: 5, opacity: state.blink && state.exprAlpha < 0.5 ? 1 : 0 }} />
        ) : null}
      </div>
    </div>
  );
};
