import React, { useContext } from 'react';
import { Img, interpolate, spring, useVideoConfig } from 'remotion';
import { RELATIONS, type RenderIllustration } from '@edu/shared';
import { COLORS, FONT_FAMILY } from '../theme';
import { MotionContext } from './CharacterRig';

type Ill = RenderIllustration;

/** Cạnh lớn nhất của hình và chiều cao dòng chú thích trong thẻ minh hoạ (pixel 1080p) */
export const ILLUSTRATION_IMAGE = 300;
const CAPTION_H = 64;
const PAD = 18;
const GAP = 10;

/** Thẻ nhiều vật: cạnh lớn nhất của từng vật theo cỡ tương đối, chữ chú thích nhỏ hơn thẻ một vật */
const SIZE_PX = { large: 300, medium: 200, small: 120 } as const;
const GROUP_FONT = 36;
const GROUP_LINE = 46;
const CLUSTER_GAP = 56;
const MAX_W = 960;
const MAX_H = 560;

/** Lưới khi đếm vật: tối đa 5 cột, ô nhỏ dần khi nhiều vật */
function grid(ill: Ill, single = ILLUSTRATION_IMAGE) {
  const n = Math.max(1, ill.count);
  if (n === 1) return { cols: 1, rows: 1, cell: single };
  const cols = n <= 5 ? n : Math.ceil(n / 2);
  const k = single / ILLUSTRATION_IMAGE;
  return { cols, rows: Math.ceil(n / cols), cell: Math.round((n <= 3 ? 190 : n <= 5 ? 150 : 128) * k) };
}

function textW(text: string, font: number) {
  return [...text].length * font * 0.56;
}

function singleSize(ill: Ill) {
  const { cols, rows, cell } = grid(ill);
  const k = cell / Math.max(ill.width, ill.height);
  const itemW = ill.count > 1 ? cell : ill.width * k;
  const itemH = ill.count > 1 ? cell : ill.height * k;
  // Thẻ đủ rộng cho cả chú thích để chữ không bị cắt
  const imgW = cols * itemW + (cols - 1) * GAP;
  const imgH = rows * itemH + (rows - 1) * GAP;
  return { w: Math.max(imgW, 200, textW(ill.caption, 44)) + PAD * 2, h: imgH + CAPTION_H + PAD * 2, imgH };
}

interface Placed {
  i: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Lớp vẽ: vật sau vật mốc (behind) < vật mốc < vật bám phía trước */
  z: number;
}

interface Caption {
  lines: string[];
  x: number;
  y: number;
  w: number;
  start: number;
}

export interface IllustrationLayout {
  w: number;
  h: number;
  scale: number;
  items: Placed[];
  captions: Caption[];
}

/** Khung của một vật (cả lưới khi đếm), cạnh lớn nhất = `max` */
function itemBox(ill: Ill, max: number) {
  if (ill.count > 1) {
    const { cols, rows, cell } = grid(ill, max);
    return { w: cols * cell + (cols - 1) * GAP, h: rows * cell + (rows - 1) * GAP };
  }
  const k = max / Math.max(ill.width, ill.height);
  return { w: ill.width * k, h: ill.height * k };
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * Xếp nhiều vật thành từng cụm theo quan hệ vị trí: vật mốc ở giữa cụm, vật bám đặt trên / dưới gầm / trong / cạnh
 * vật mốc. Các cụm đứng cạnh nhau trên cùng một mặt đất, chú thích ghép ("Chim sẻ trên cây") dưới mỗi cụm.
 */
function groupLayout(items: Ill[]): IllustrationLayout {
  const anchors = items.map((it, i) => i).filter((i) => !items[i].relation);
  const clusters: { placed: Placed[]; caption: Caption }[] = [];
  for (const a of anchors) {
    const A = itemBox(items[a], SIZE_PX[items[a].size]);
    const placed: Placed[] = [{ i: a, x: 0, y: 0, w: A.w, h: A.h, z: 1 }];
    const deps = items.map((it, i) => i).filter((i) => items[i].relation?.to === a);
    const same = new Map<string, number[]>();
    for (const d of deps) {
      const where = items[d].relation!.where;
      same.set(where, [...(same.get(where) ?? []), d]);
    }
    for (const [where, list] of same) {
      list.forEach((d, k) => {
        let { w, h } = itemBox(items[d], SIZE_PX[items[d].size]);
        // Vật ở trong / dưới gầm phải nhỏ hơn vật mốc để nằm gọn
        const fit = where === 'in' ? 0.55 : where === 'under' ? 0.6 : where === 'behind' ? 0.8 : 1.2;
        const f = Math.min(1, (A.h * fit) / h, where === 'in' ? (A.w * 0.55) / w : 1);
        w *= f;
        h *= f;
        const spread = (k - (list.length - 1) / 2) * (w + 12);
        let x = (A.w - w) / 2 + spread;
        let y = A.h - h;
        let z = 2;
        // Mép trên của vật mốc thường là ngọn lá / mép bàn nhìn nghiêng: lún xuống để vật thật sự nằm/đậu trên đó
        if (where === 'on') y = A.h * 0.26 - h;
        else if (where === 'above') y = -h - 14;
        else if (where === 'in') y = (A.h - h) / 2;
        else if (where === 'in-front-of') y = A.h - h * 0.85;
        else if (where === 'behind') {
          x = A.w * 0.55 + spread;
          y = A.h - h - A.h * 0.08;
          z = 0;
        } else if (where === 'right-of' || where === 'next-to') x = A.w + 16 + k * (w + 12);
        else if (where === 'left-of') x = -w - 16 - k * (w + 12);
        placed.push({ i: d, x, y, w, h, z });
      });
    }
    const minX = Math.min(...placed.map((p) => p.x));
    const minY = Math.min(...placed.map((p) => p.y));
    for (const p of placed) {
      p.x -= minX;
      p.y -= minY;
    }
    const lines = deps.length
      ? deps
          .slice(0, 2)
          .map((d) => `${items[d].caption} ${RELATIONS[items[d].relation!.where]} ${lowerFirst(items[a].caption)}`)
      : [items[a].caption];
    const start = Math.max(...placed.map((p) => items[p.i].countStarts.at(-1) ?? items[p.i].start)) + 4;
    clusters.push({ placed, caption: { lines, x: 0, y: 0, w: Math.max(...lines.map((l) => textW(l, GROUP_FONT))), start } });
  }

  // Các cụm đứng cạnh nhau, chân chạm cùng một đường
  const sizes = clusters.map((c) => ({
    w: Math.max(...c.placed.map((p) => p.x + p.w)),
    h: Math.max(...c.placed.map((p) => p.y + p.h)),
  }));
  const ground = Math.max(...sizes.map((s) => s.h));
  const capH = Math.max(...clusters.map((c) => c.caption.lines.length)) * GROUP_LINE + 8;
  const items2: Placed[] = [];
  const captions: Caption[] = [];
  let x = 0;
  clusters.forEach((c, k) => {
    const colW = Math.max(sizes[k].w, c.caption.w);
    const ox = x + (colW - sizes[k].w) / 2;
    for (const p of c.placed) items2.push({ ...p, x: p.x + ox, y: p.y + ground - sizes[k].h });
    captions.push({ ...c.caption, x: x + colW / 2, y: ground + 8 });
    x += colW + CLUSTER_GAP;
  });
  const contentW = x - CLUSTER_GAP;
  const contentH = ground + capH;
  const scale = Math.min(1, MAX_W / contentW, MAX_H / contentH);
  return {
    w: contentW * scale + PAD * 2,
    h: contentH * scale + PAD * 2,
    scale,
    items: items2.sort((a, b) => a.z - b.z),
    captions,
  };
}

/** Kích thước thẻ minh hoạ của một shot (để xếp chỗ tránh nhân vật) */
export function illustrationSize(items: Ill[]) {
  if (items.length === 1) return singleSize(items[0]);
  const { w, h } = groupLayout(items);
  return { w, h };
}

/** Một vật nhấp nhô nhẹ, lệch nhịp theo thứ tự để cả nhóm trông sống động */
function idleMotion(local: number, start: number, fps: number, k: number, motion: number) {
  const t = (local - start) / fps;
  return {
    dy: Math.sin(t * Math.PI * 0.9 + k * 1.7) * 5 * motion,
    rot: Math.sin(t * Math.PI * 0.6 + k * 2.3) * 2.2 * motion,
    sq: 1 + Math.sin(t * Math.PI * 1.4 + k) * 0.015 * motion,
  };
}

/**
 * Thẻ hình minh hoạ bật ra cạnh nhân vật khi lời thoại nhắc tới sự vật, nhấp nhô nhẹ, mờ dần cuối shot.
 * Một vật: như thẻ ảnh; khi đếm (count > 1) hình được nhân đúng số lượng, từng cái bật ra kèm số theo nhịp đếm.
 * Nhiều vật: mỗi vật bật ra đúng lúc được nhắc tới, đặt đúng vị trí so với vật mốc (chim đậu trên cây, mèo dưới gầm bàn).
 */
export const Illustration: React.FC<{
  items: Ill[];
  at: { x: number; y: number };
  local: number;
  duration: number;
}> = ({ items, at, local, duration }) => {
  const { fps } = useVideoConfig();
  const first = Math.min(...items.map((it) => it.start));
  if (!items.length || local < first) return null;
  const pop = spring({ frame: local - first, fps, config: { damping: 11, stiffness: 150 } });
  const out = interpolate(local, [duration - 10, duration], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const bob = Math.sin(((local - first) / fps) * Math.PI * 0.9) * 6;
  const tilt = (1 - pop) * -8;
  const single = items.length === 1;
  const size = single ? singleSize(items[0]) : null;
  const group = single ? null : groupLayout(items);
  const w = size?.w ?? group!.w;
  const h = size?.h ?? group!.h;

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
      {single ? <SingleCard ill={items[0]} local={local} imgH={size!.imgH} /> : <GroupCard items={items} layout={group!} local={local} />}
    </div>
  );
};

const SingleCard: React.FC<{ ill: Ill; local: number; imgH: number }> = ({ ill, local, imgH }) => {
  const { fps } = useVideoConfig();
  const { cols, cell } = grid(ill);
  const counting = ill.count > 1;
  const last = ill.countStarts[ill.countStarts.length - 1] ?? ill.start;
  // Đếm xong mới hiện chú thích tổng ("6 cây bút chì")
  const captionIn = counting
    ? interpolate(local, [last + 4, last + 12], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
    : 1;
  const idle = idleMotion(local, ill.start, fps, 0, useContext(MotionContext));
  return (
    <>
      {counting ? (
        <CountGrid ill={ill} local={local} cols={cols} cell={cell} height={imgH} />
      ) : (
        <Img
          src={ill.src}
          style={{
            height: imgH,
            width: '100%',
            objectFit: 'contain',
            transformOrigin: '50% 100%',
            transform: `rotate(${idle.rot}deg) scaleY(${idle.sq})`,
          }}
        />
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
    </>
  );
};

const CountGrid: React.FC<{ ill: Ill; local: number; cols: number; cell: number; height: number }> = ({
  ill,
  local,
  cols,
  cell,
  height,
}) => {
  const { fps } = useVideoConfig();
  const badge = Math.max(28, Math.round(cell * 0.27));
  return (
    <div
      style={{
        height,
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
                minWidth: badge,
                height: badge,
                borderRadius: badge / 2,
                background: COLORS.badgeBg,
                border: `4px solid ${COLORS.badgeBorder}`,
                color: COLORS.badgeText,
                fontFamily: FONT_FAMILY,
                fontWeight: 800,
                fontSize: Math.round(badge * 0.65),
                lineHeight: `${badge - 8}px`,
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
  );
};

const GroupCard: React.FC<{ items: Ill[]; layout: IllustrationLayout; local: number }> = ({ items, layout, local }) => {
  const { fps } = useVideoConfig();
  const motion = useContext(MotionContext);
  const k = layout.scale;
  return (
    <div style={{ position: 'relative', width: layout.w - PAD * 2, height: layout.h - PAD * 2 }}>
      {layout.items.map((p) => {
        const it = items[p.i];
        if (local < it.start) return null;
        const pop = spring({ frame: local - it.start, fps, config: { damping: 10, stiffness: 160 } });
        // Vật bám phía trên (chim đậu trên cây) đáp xuống từ trên cao; vật khác nảy lên tại chỗ
        const drop = it.relation && (it.relation.where === 'on' || it.relation.where === 'above') ? (1 - pop) * -60 : 0;
        const idle = idleMotion(local, it.start, fps, p.i + 1, motion);
        const anchor = !it.relation;
        return (
          <div
            key={p.i}
            style={{
              position: 'absolute',
              left: p.x * k,
              top: p.y * k + drop + (anchor ? 0 : idle.dy * 0.6),
              width: p.w * k,
              height: p.h * k,
              transformOrigin: '50% 100%',
              transform: `scale(${Math.min(1.08, pop)}) rotate(${anchor ? idle.rot * 0.4 : idle.rot}deg) scaleY(${idle.sq})`,
            }}
          >
            {it.count > 1 ? (
              <CountGrid
                ill={it}
                local={local}
                cols={grid(it).cols}
                cell={Math.max(8, (p.w * k - (grid(it).cols - 1) * GAP) / grid(it).cols)}
                height={p.h * k}
              />
            ) : (
              <Img src={it.src} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            )}
          </div>
        );
      })}
      {layout.captions.map((c, i) => {
        const o = interpolate(local, [c.start, c.start + 8], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: c.x * k - (c.w * k) / 2 - 20,
              top: c.y * k,
              width: c.w * k + 40,
              textAlign: 'center',
              fontFamily: FONT_FAMILY,
              fontWeight: 800,
              fontSize: GROUP_FONT * k,
              lineHeight: `${GROUP_LINE * k}px`,
              color: COLORS.badgeText,
              whiteSpace: 'nowrap',
              opacity: o,
            }}
          >
            {c.lines.map((l) => (
              <div key={l}>{l}</div>
            ))}
          </div>
        );
      })}
    </div>
  );
};
