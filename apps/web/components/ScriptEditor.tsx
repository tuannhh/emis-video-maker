'use client';

import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { EMOTIONS, VOICES, type Emotion, type LessonScript, type ScriptLine } from '@edu/shared';

interface Props {
  value: LessonScript;
  onChange: (script: LessonScript) => void;
}

const ROLE_LABEL = { child: 'Trẻ em', adult: 'Người lớn', mascot: 'Linh vật', narrator: 'Người dẫn chuyện' } as const;

/** Vị trí chèn: trước câu thứ `index` của phần `si` (index = số câu → cuối phần) */
interface Slot {
  si: number;
  index: number;
}

export function ScriptEditor({ value, onChange }: Props) {
  const [showTts, setShowTts] = useState(false);
  const [dragging, setDragging] = useState<{ si: number; li: number } | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const set = (patch: Partial<LessonScript>) => onChange({ ...value, ...patch });
  const wordCount = value.sections.reduce(
    (n, s) => n + s.lines.reduce((m, l) => m + l.text.trim().split(/\s+/).filter(Boolean).length, 0),
    0,
  );

  const updateLine = (si: number, li: number, patch: Partial<ScriptLine>) =>
    set({
      sections: value.sections.map((s, i) =>
        i !== si ? s : { ...s, lines: s.lines.map((l, j) => (j !== li ? l : { ...l, ...patch })) },
      ),
    });

  const removeLine = (si: number, li: number) =>
    set({
      sections: value.sections.map((s, i) => (i !== si ? s : { ...s, lines: s.lines.filter((_, j) => j !== li) })),
    });

  /** Đưa con trỏ vào câu vừa thêm/di chuyển (sau khi giao diện đã cập nhật) */
  const pendingFocus = useRef<string | null>(null);
  const focusLine = (si: number, li: number, part: 'textarea' | '.line-handle' = 'textarea') => {
    pendingFocus.current = `[data-line="${si}-${li}"] ${part}`;
  };
  useEffect(() => {
    if (!pendingFocus.current) return;
    rootRef.current?.querySelector<HTMLElement>(pendingFocus.current)?.focus();
    pendingFocus.current = null;
  });

  /** Chèn câu mới cho nhân vật `speaker` vào phần `si`, trước câu thứ `index` */
  const insertLine = (si: number, index: number, speaker: string) => {
    const line: ScriptLine = { speaker, text: '', ttsText: '', emotion: 'cheerful', visualNote: '' };
    set({
      sections: value.sections.map((s, i) =>
        i !== si ? s : { ...s, lines: [...s.lines.slice(0, index), line, ...s.lines.slice(index)] },
      ),
    });
    focusLine(si, index);
  };

  /** Người nói hợp lý cho câu chèn sau câu `li`: người đang đối thoại với người nói câu đó */
  const replyTo = (si: number, li: number) => {
    const lines = value.sections[si].lines;
    const cur = lines[li]?.speaker;
    const partner = lines
      .slice(0, li)
      .reverse()
      .find((l) => l.speaker !== cur)?.speaker;
    const other = value.characters.find((c) => c.id !== cur && c.role !== 'narrator') ?? value.characters.find((c) => c.id !== cur);
    return partner ?? other?.id ?? cur ?? value.characters[0].id;
  };

  /** Mỗi phần phải còn ít nhất một câu: câu duy nhất của một phần không chuyển sang phần khác được */
  const canMove = (from: { si: number; li: number }, to: Slot) =>
    from.si === to.si || value.sections[from.si].lines.length > 1;

  const moveLine = (from: { si: number; li: number }, to: Slot) => {
    if (!canMove(from, to)) return null;
    // Rút câu ra trước nên vị trí đích phía sau trong cùng phần lùi lại một
    const index = to.si === from.si && to.index > from.li ? to.index - 1 : to.index;
    if (to.si === from.si && index === from.li) return null;
    const line = value.sections[from.si].lines[from.li];
    const sections = value.sections.map((s) => ({ ...s, lines: [...s.lines] }));
    sections[from.si].lines.splice(from.li, 1);
    sections[to.si].lines.splice(index, 0, line);
    set({ sections });
    return { si: to.si, li: index };
  };

  /** Phím ↑ ↓ trên tay nắm: chuyển câu lên/xuống một bậc, qua được ranh giới giữa các phần */
  const nudge = (si: number, li: number, dir: -1 | 1) => {
    const n = value.sections[si].lines.length;
    let to: Slot | null = null;
    if (dir < 0) to = li > 0 ? { si, index: li - 1 } : si > 0 ? { si: si - 1, index: value.sections[si - 1].lines.length } : null;
    else to = li < n - 1 ? { si, index: li + 2 } : si < value.sections.length - 1 ? { si: si + 1, index: 0 } : null;
    if (!to) return;
    const at = moveLine({ si, li }, to);
    if (at) focusLine(at.si, at.li, '.line-handle');
  };

  /**
   * Chỗ thả theo toạ độ con trỏ: trước câu đầu tiên có tâm nằm dưới con trỏ. Ở khe giữa hai phần thì
   * gần cuối phần trên hơn → thả vào cuối phần trên, ngược lại → đầu phần dưới.
   */
  const slotAt = (y: number): Slot | null => {
    const rows = [...(rootRef.current?.querySelectorAll<HTMLElement>('[data-line]') ?? [])].map((el) => {
      const [si, li] = el.dataset.line!.split('-').map(Number);
      return { si, li, r: el.getBoundingClientRect() };
    });
    if (!rows.length) return null;
    const k = rows.findIndex((row) => y < row.r.top + row.r.height / 2);
    const last = rows[rows.length - 1];
    if (k < 0) return { si: last.si, index: last.li + 1 };
    const next = rows[k];
    const prev = rows[k - 1];
    if (prev && prev.si !== next.si && y < (prev.r.bottom + next.r.top) / 2) return { si: prev.si, index: prev.li + 1 };
    return { si: next.si, index: next.li };
  };

  const onHandleMove = (e: PointerEvent<HTMLButtonElement>) => {
    if (!dragging) return;
    // Kéo sát mép màn hình thì cuộn trang theo
    if (e.clientY < 70) window.scrollBy(0, -14);
    else if (e.clientY > window.innerHeight - 70) window.scrollBy(0, 14);
    const target = slotAt(e.clientY);
    const next = target && canMove(dragging, target) ? target : null;
    if (next?.si !== slot?.si || next?.index !== slot?.index) setSlot(next);
  };

  const endDrag = (drop: boolean) => {
    if (drop && dragging && slot) {
      const at = moveLine(dragging, slot);
      if (at) focusLine(at.si, at.li, '.line-handle');
    }
    setDragging(null);
    setSlot(null);
  };

  return (
    <div ref={rootRef}>
      <div className="card">
        <div className="card-head">
          <h2>Thông tin bài học</h2>
          <span className="muted small">
            {wordCount} từ · ước tính {Math.round(wordCount / 2.4)} giây lời thoại
          </span>
        </div>
        <label className="field">
          <span>Tên bài</span>
          <input type="text" value={value.title} onChange={(e) => set({ title: e.target.value })} />
        </label>
        <label className="field">
          <span>Tóm tắt</span>
          <textarea rows={2} value={value.summary} onChange={(e) => set({ summary: e.target.value })} />
        </label>
        <ListEditor label="Mục tiêu bài học" items={value.objectives} onChange={(objectives) => set({ objectives })} />
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Nhân vật</h2>
          <span className="muted small">Nhân vật mới sẽ được AI vẽ theo mô tả và lưu vào thư viện</span>
        </div>
        {value.characters.map((c, ci) => (
          <div key={c.id} className="char-row">
            <div>
              <input
                type="text"
                value={c.name}
                onChange={(e) =>
                  set({ characters: value.characters.map((x, i) => (i === ci ? { ...x, name: e.target.value } : x)) })
                }
              />
              <div className="muted small" style={{ marginTop: 4 }}>
                {ROLE_LABEL[c.role]} · <code>{c.id}</code>
              </div>
            </div>
            <select
              value={c.voice}
              onChange={(e) =>
                set({ characters: value.characters.map((x, i) => (i === ci ? { ...x, voice: e.target.value } : x)) })
              }
            >
              {VOICES.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.id} — {v.suits}
                </option>
              ))}
            </select>
            {c.role === 'narrator' ? (
              <span className="muted small">Không có hình, chỉ có giọng</span>
            ) : (
              <textarea
                rows={2}
                value={c.description}
                title="Mô tả ngoại hình (tiếng Anh) để AI vẽ"
                onChange={(e) =>
                  set({
                    characters: value.characters.map((x, i) => (i === ci ? { ...x, description: e.target.value } : x)),
                  })
                }
              />
            )}
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Kịch bản</h2>
            <div className="muted small">
              Kéo ⋮⋮ để đổi thứ tự câu (hoặc chọn ⋮⋮ rồi bấm phím ↑ ↓); bấm + để chèn câu ngay bên dưới
            </div>
          </div>
          <label className="actions small">
            <input type="checkbox" checked={showTts} onChange={(e) => setShowTts(e.target.checked)} />
            Hiện cách đọc cho máy (số viết thành chữ)
          </label>
        </div>
        {value.sections.map((s, si) => (
          <div key={si} className="section-block">
            <div className="section-block-head">
              <input
                type="text"
                value={s.heading}
                title="Tên phần"
                onChange={(e) =>
                  set({ sections: value.sections.map((x, i) => (i === si ? { ...x, heading: e.target.value } : x)) })
                }
              />
              <input
                type="text"
                value={s.setting}
                title="Bối cảnh"
                onChange={(e) =>
                  set({ sections: value.sections.map((x, i) => (i === si ? { ...x, setting: e.target.value } : x)) })
                }
              />
              <span className="muted small" style={{ alignSelf: 'center' }}>
                Phần {si + 1}
              </span>
            </div>
            {s.lines.map((l, li) => (
              <div
                key={li}
                data-line={`${si}-${li}`}
                className={[
                  'line',
                  dragging?.si === si && dragging.li === li ? 'line-dragging' : '',
                  slot?.si === si && slot.index === li ? 'drop-before' : '',
                  slot?.si === si && slot.index === li + 1 && li === s.lines.length - 1 ? 'drop-after' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <button
                  type="button"
                  className="line-handle"
                  title="Kéo để đổi thứ tự (hoặc bấm phím ↑ ↓)"
                  aria-label={`Di chuyển câu ${li + 1} của phần ${si + 1}`}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    e.preventDefault();
                    e.currentTarget.setPointerCapture(e.pointerId);
                    setDragging({ si, li });
                  }}
                  onPointerMove={onHandleMove}
                  onPointerUp={() => endDrag(true)}
                  onPointerCancel={() => endDrag(false)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') return endDrag(false);
                    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
                    e.preventDefault();
                    nudge(si, li, e.key === 'ArrowUp' ? -1 : 1);
                  }}
                >
                  <svg width="12" height="18" viewBox="0 0 12 18" aria-hidden="true">
                    {[3, 9].flatMap((x) => [3, 9, 15].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.6" fill="currentColor" />))}
                  </svg>
                </button>
                <select value={l.speaker} onChange={(e) => updateLine(si, li, { speaker: e.target.value })}>
                  {value.characters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <textarea
                  rows={1}
                  value={l.text}
                  placeholder="Nhập câu thoại…"
                  onChange={(e) => updateLine(si, li, { text: e.target.value, ttsText: e.target.value })}
                />
                <select value={l.emotion} onChange={(e) => updateLine(si, li, { emotion: e.target.value as Emotion })}>
                  {Object.entries(EMOTIONS).map(([id, em]) => (
                    <option key={id} value={id}>
                      {em.label}
                    </option>
                  ))}
                </select>
                <div className="line-actions">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    title="Chèn câu mới ngay bên dưới"
                    onClick={() => insertLine(si, li + 1, replyTo(si, li))}
                  >
                    +
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    title="Xoá câu"
                    disabled={s.lines.length <= 1}
                    onClick={() => removeLine(si, li)}
                  >
                    ✕
                  </button>
                </div>
                {showTts ? (
                  <input
                    className="line-tts"
                    type="text"
                    value={l.ttsText}
                    title="Cách đọc"
                    onChange={(e) => updateLine(si, li, { ttsText: e.target.value })}
                  />
                ) : null}
              </div>
            ))}
            <div className="line-add">
              <span className="muted small">Thêm câu cuối phần cho:</span>
              {value.characters.map((c) => (
                <button key={c.id} type="button" className="btn btn-sm" onClick={() => insertLine(si, s.lines.length, c.id)}>
                  + {c.name}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <ListEditor label="Ghi nhớ cuối bài" items={value.recap} onChange={(recap) => set({ recap })} />
      </div>
    </div>
  );
}

function ListEditor({ label, items, onChange }: { label: string; items: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="field">
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>{label}</div>
      <div className="list-edit">
        {items.map((item, i) => (
          <div key={i} className="list-edit-row">
            <input type="text" value={item} onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))} />
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={items.length <= 1}
              onClick={() => onChange(items.filter((_, j) => j !== i))}
            >
              ✕
            </button>
          </div>
        ))}
        <div>
          <button type="button" className="btn btn-sm" onClick={() => onChange([...items, ''])}>
            + Thêm
          </button>
        </div>
      </div>
    </div>
  );
}
