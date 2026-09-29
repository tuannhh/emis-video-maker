import React from 'react';
import { Img } from 'remotion';
import type { Pose, RenderCharacter } from '@edu/shared';
import { POSES } from '@edu/shared';
import { POSE_BLEND } from '../acting';

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
 * Nhân vật đứng yên như diễn viên thật: thân và đầu không rung lắc, chỉ tay đổi cử chỉ, miệng nhép, mắt chớp.
 * Chuyển động toàn thân chỉ có khi nhảy lên reo mừng và khi quay người về phía người nói.
 */
export const CharacterRig: React.FC<Props> = ({ character: ch, x, feet, bodyHeight, state }) => {
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
  const scaleX = 1 / Math.sqrt(scaleY);
  const turn = state.turnAgo < TURN_SQUASH.length ? TURN_SQUASH[state.turnAgo] : 1;
  const dir = ch.facing === 'front' ? 1 : state.flip ? -1 : 1;

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
          transform: `scaleX(${dir * scaleX * turn}) scaleY(${scaleY})`,
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
        {ch.layered && ch.blink ? <Img src={ch.blink} style={{ ...layer, zIndex: 4, opacity: state.blink ? 1 : 0 }} /> : null}
      </div>
    </div>
  );
};
