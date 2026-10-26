"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import {
  EMOTIONS,
  VOICES,
  VOICE_YOUTH,
  defaultYouth,
  type Emotion,
  type LessonScript,
  type ScriptLine,
  type VoiceYouth,
} from "@edu/shared";
import { api } from "@/lib/api";

interface Props {
  value: LessonScript;
  onChange: (script: LessonScript) => void;
  /** Kịch bản trước lần AI sửa gần nhất: tô màu câu đã đổi, cho hoàn tác từng câu */
  previous?: LessonScript | null;
  /** Câu được chọn để góp ý ("phần:câu") */
  selected?: string[];
  onSelect?: (keys: string[]) => void;
}

type LineMark = { kind: "changed"; old: ScriptLine } | { kind: "added" };
interface Removed {
  si: number;
  /** Chèn lại trước câu thứ `before` của phần hiện tại */
  before: number;
  line: ScriptLine;
}

const sameLine = (a: ScriptLine, b: ScriptLine) =>
  a.speaker === b.speaker && a.text.trim() === b.text.trim();

/**
 * So kịch bản hiện tại với bản trước khi AI sửa (từng phần theo thứ tự): câu khớp nhau theo dãy con chung dài nhất,
 * câu không khớp nằm cùng một khoảng thì ghép thành "đã sửa", dư bên mới là "thêm", dư bên cũ là "đã xoá".
 */
function diffScript(prev: LessonScript, cur: LessonScript) {
  const marks = new Map<string, LineMark>();
  const removed: Removed[] = [];
  cur.sections.forEach((sec, si) => {
    const old = prev.sections[si]?.lines ?? [];
    const now = sec.lines;
    const L = Array.from({ length: old.length + 1 }, () =>
      new Array<number>(now.length + 1).fill(0),
    );
    for (let i = old.length - 1; i >= 0; i--)
      for (let j = now.length - 1; j >= 0; j--)
        L[i][j] = sameLine(old[i], now[j])
          ? L[i + 1][j + 1] + 1
          : Math.max(L[i + 1][j], L[i][j + 1]);
    let i = 0;
    let j = 0;
    const flush = (oi: number[], nj: number[]) => {
      nj.forEach((jj, k) =>
        marks.set(
          `${si}:${jj}`,
          k < oi.length
            ? { kind: "changed", old: old[oi[k]] }
            : { kind: "added" },
        ),
      );
      for (const ii of oi.slice(nj.length))
        removed.push({
          si,
          before: nj.length ? nj[nj.length - 1] + 1 : j,
          line: old[ii],
        });
    };
    let oi: number[] = [];
    let nj: number[] = [];
    while (i < old.length || j < now.length) {
      if (i < old.length && j < now.length && sameLine(old[i], now[j])) {
        flush(oi, nj);
        oi = [];
        nj = [];
        i++;
        j++;
      } else if (
        j < now.length &&
        (i >= old.length || L[i][j + 1] >= L[i + 1][j])
      )
        nj.push(j++);
      else oi.push(i++);
    }
    flush(oi, nj);
  });
  return { marks, removed };
}

/** Phát thử giọng nhân vật */
function VoicePreview({
  voice,
  role,
  youth,
  name,
}: {
  voice: string;
  role: string;
  youth?: VoiceYouth;
  name: string;
}) {
  const [state, setState] = useState<"idle" | "loading" | "playing" | "error">(
    "idle",
  );
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => audio.current?.pause(), []);
  const play = async () => {
    if (state === "playing") {
      audio.current?.pause();
      setState("idle");
      return;
    }
    setState("loading");
    try {
      const { url } = await api.voicePreview({ voice, role, youth, name });
      audio.current?.pause();
      const a = new Audio(url);
      audio.current = a;
      a.onended = () => setState("idle");
      await a.play();
      setState("playing");
    } catch {
      setState("error");
    }
  };
  return (
    <button
      type="button"
      className="btn btn-sm"
      onClick={play}
      disabled={state === "loading"}
      title="Nghe thử giọng (đọc đúng như khi lồng tiếng)"
    >
      {state === "loading" ? (
        <span className="spinner" />
      ) : state === "playing" ? (
        "■"
      ) : (
        "▶"
      )}{" "}
      {state === "error" ? "Lỗi, thử lại" : "Nghe thử"}
    </button>
  );
}

const ROLE_LABEL = {
  child: "Trẻ em",
  adult: "Người lớn",
  mascot: "Linh vật",
  narrator: "Người dẫn chuyện",
} as const;

/** Vị trí chèn: trước câu thứ `index` của phần `si` (index = số câu → cuối phần) */
interface Slot {
  si: number;
  index: number;
}

export function ScriptEditor({
  value,
  onChange,
  previous,
  selected = [],
  onSelect,
}: Props) {
  const [showTts, setShowTts] = useState(false);
  const diff = useMemo(
    () => (previous ? diffScript(previous, value) : null),
    [previous, value],
  );
  const changes = diff ? diff.marks.size + diff.removed.length : 0;
  const picked = new Set(selected);
  const toggle = (key: string) =>
    onSelect?.(
      picked.has(key) ? selected.filter((k) => k !== key) : [...selected, key],
    );
  const setCharacter = (
    ci: number,
    patch: Partial<LessonScript["characters"][number]>,
  ) =>
    set({
      characters: value.characters.map((x, i) =>
        i === ci ? { ...x, ...patch } : x,
      ),
    });
  const restore = (r: Removed) =>
    set({
      sections: value.sections.map((s, i) =>
        i !== r.si
          ? s
          : {
              ...s,
              lines: [
                ...s.lines.slice(0, r.before),
                r.line,
                ...s.lines.slice(r.before),
              ],
            },
      ),
    });
  const [dragging, setDragging] = useState<{ si: number; li: number } | null>(
    null,
  );
  const [slot, setSlot] = useState<Slot | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const set = (patch: Partial<LessonScript>) =>
    onChange({ ...value, ...patch });
  const wordCount = value.sections.reduce(
    (n, s) =>
      n +
      s.lines.reduce(
        (m, l) => m + l.text.trim().split(/\s+/).filter(Boolean).length,
        0,
      ),
    0,
  );

  const updateLine = (si: number, li: number, patch: Partial<ScriptLine>) =>
    set({
      sections: value.sections.map((s, i) =>
        i !== si
          ? s
          : {
              ...s,
              lines: s.lines.map((l, j) => (j !== li ? l : { ...l, ...patch })),
            },
      ),
    });

  const removeLine = (si: number, li: number) => {
    set({
      sections: value.sections.map((s, i) =>
        i !== si ? s : { ...s, lines: s.lines.filter((_, j) => j !== li) },
      ),
    });
    onSelect?.([]);
  };

  /** Đưa con trỏ vào câu vừa thêm/di chuyển (sau khi giao diện đã cập nhật) */
  const pendingFocus = useRef<string | null>(null);
  const focusLine = (
    si: number,
    li: number,
    part: "textarea" | ".line-handle" = "textarea",
  ) => {
    pendingFocus.current = `[data-line="${si}-${li}"] ${part}`;
  };
  useEffect(() => {
    if (!pendingFocus.current) return;
    rootRef.current?.querySelector<HTMLElement>(pendingFocus.current)?.focus();
    pendingFocus.current = null;
  });

  /** Chèn câu mới cho nhân vật `speaker` vào phần `si`, trước câu thứ `index` */
  const insertLine = (si: number, index: number, speaker: string) => {
    const line: ScriptLine = {
      speaker,
      text: "",
      ttsText: "",
      emotion: "cheerful",
      visualNote: "",
    };
    onSelect?.([]);
    set({
      sections: value.sections.map((s, i) =>
        i !== si
          ? s
          : {
              ...s,
              lines: [
                ...s.lines.slice(0, index),
                line,
                ...s.lines.slice(index),
              ],
            },
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
    const other =
      value.characters.find((c) => c.id !== cur && c.role !== "narrator") ??
      value.characters.find((c) => c.id !== cur);
    return partner ?? other?.id ?? cur ?? value.characters[0].id;
  };

  /** Mỗi phần phải còn ít nhất một câu: câu duy nhất của một phần không chuyển sang phần khác được */
  const canMove = (from: { si: number; li: number }, to: Slot) =>
    from.si === to.si || value.sections[from.si].lines.length > 1;

  const moveLine = (from: { si: number; li: number }, to: Slot) => {
    if (!canMove(from, to)) return null;
    // Rút câu ra trước nên vị trí đích phía sau trong cùng phần lùi lại một
    const index =
      to.si === from.si && to.index > from.li ? to.index - 1 : to.index;
    if (to.si === from.si && index === from.li) return null;
    const line = value.sections[from.si].lines[from.li];
    const sections = value.sections.map((s) => ({ ...s, lines: [...s.lines] }));
    sections[from.si].lines.splice(from.li, 1);
    sections[to.si].lines.splice(index, 0, line);
    set({ sections });
    onSelect?.([]);
    return { si: to.si, li: index };
  };

  /** Phím ↑ ↓ trên tay nắm: chuyển câu lên/xuống một bậc, qua được ranh giới giữa các phần */
  const nudge = (si: number, li: number, dir: -1 | 1) => {
    const n = value.sections[si].lines.length;
    let to: Slot | null = null;
    if (dir < 0)
      to =
        li > 0
          ? { si, index: li - 1 }
          : si > 0
            ? { si: si - 1, index: value.sections[si - 1].lines.length }
            : null;
    else
      to =
        li < n - 1
          ? { si, index: li + 2 }
          : si < value.sections.length - 1
            ? { si: si + 1, index: 0 }
            : null;
    if (!to) return;
    const at = moveLine({ si, li }, to);
    if (at) focusLine(at.si, at.li, ".line-handle");
  };

  /**
   * Chỗ thả theo toạ độ con trỏ: trước câu đầu tiên có tâm nằm dưới con trỏ. Ở khe giữa hai phần thì
   * gần cuối phần trên hơn → thả vào cuối phần trên, ngược lại → đầu phần dưới.
   */
  const slotAt = (y: number): Slot | null => {
    const rows = [
      ...(rootRef.current?.querySelectorAll<HTMLElement>("[data-line]") ?? []),
    ].map((el) => {
      const [si, li] = el.dataset.line!.split("-").map(Number);
      return { si, li, r: el.getBoundingClientRect() };
    });
    if (!rows.length) return null;
    const k = rows.findIndex((row) => y < row.r.top + row.r.height / 2);
    const last = rows[rows.length - 1];
    if (k < 0) return { si: last.si, index: last.li + 1 };
    const next = rows[k];
    const prev = rows[k - 1];
    if (prev && prev.si !== next.si && y < (prev.r.bottom + next.r.top) / 2)
      return { si: prev.si, index: prev.li + 1 };
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
      if (at) focusLine(at.si, at.li, ".line-handle");
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
            {wordCount} từ · ước tính {Math.round(wordCount / 2.4)} giây lời
            thoại
          </span>
        </div>
        <label className="field">
          <span>Tên bài</span>
          <input
            type="text"
            value={value.title}
            onChange={(e) => set({ title: e.target.value })}
          />
        </label>
        <label className="field">
          <span>Tóm tắt</span>
          <textarea
            rows={2}
            value={value.summary}
            onChange={(e) => set({ summary: e.target.value })}
          />
        </label>
        <ListEditor
          label="Mục tiêu bài học"
          items={value.objectives}
          onChange={(objectives) => set({ objectives })}
        />
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Nhân vật</h2>
          <span className="muted small">
            Nhân vật mới sẽ được AI vẽ theo mô tả và lưu vào thư viện
          </span>
        </div>
        {value.characters.map((c, ci) => (
          <div key={c.id} className="char-row">
            <div>
              <input
                type="text"
                value={c.name}
                onChange={(e) =>
                  set({
                    characters: value.characters.map((x, i) =>
                      i === ci ? { ...x, name: e.target.value } : x,
                    ),
                  })
                }
              />
              <div className="muted small" style={{ marginTop: 4 }}>
                {ROLE_LABEL[c.role]} · <code>{c.id}</code>
              </div>
            </div>
            <div className="voice-cell">
              <select
                value={c.voice}
                onChange={(e) => setCharacter(ci, { voice: e.target.value })}
                title="Giọng đọc"
              >
                {VOICES.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.id} — {v.suits}
                  </option>
                ))}
              </select>
              <select
                value={c.youth ?? defaultYouth(c.role)}
                onChange={(e) =>
                  setCharacter(ci, { youth: e.target.value as VoiceYouth })
                }
                title="Độ trẻ của giọng: hệ thống nâng cao độ và âm sắc sau khi đọc"
              >
                {Object.entries(VOICE_YOUTH).map(([id, y]) => (
                  <option key={id} value={id}>
                    {y.label}
                  </option>
                ))}
              </select>
              <VoicePreview
                voice={c.voice}
                role={c.role}
                youth={c.youth}
                name={c.name}
              />
            </div>
            {c.role === "narrator" ? (
              <span className="muted small">Không có hình, chỉ có giọng</span>
            ) : (
              <textarea
                rows={2}
                value={c.description}
                title="Mô tả ngoại hình (tiếng Anh) để AI vẽ"
                onChange={(e) =>
                  setCharacter(ci, { description: e.target.value })
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
              Kéo ⋮⋮ để đổi thứ tự câu (hoặc chọn ⋮⋮ rồi bấm phím ↑ ↓); bấm + để
              chèn câu ngay bên dưới
            </div>
          </div>
          <label className="actions small">
            <input
              type="checkbox"
              checked={showTts}
              onChange={(e) => setShowTts(e.target.checked)}
            />
            Hiện cách đọc và chỉ dẫn diễn xuất
          </label>
        </div>
        {diff && changes ? (
          <div className="alert alert-info diff-banner">
            <span>
              AI vừa sửa <strong>{changes}</strong> chỗ theo góp ý (tô màu bên
              dưới); các câu khác giữ nguyên. Không ưng chỗ nào thì bấm “Hoàn
              tác” ở câu đó.
            </span>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => previous && onChange(previous)}
            >
              Hoàn tác tất cả
            </button>
          </div>
        ) : null}
        {onSelect ? (
          <div className="muted small" style={{ marginBottom: 6 }}>
            Muốn AI chỉ sửa vài câu: tích ô ☐ ở cuối các câu đó rồi bấm “Yêu cầu
            AI sửa”
            {selected.length ? ` — đang chọn ${selected.length} câu` : ""}.
          </div>
        ) : null}
        {value.sections.map((s, si) => (
          <div key={si} className="section-block">
            <div className="section-block-head">
              <input
                type="text"
                value={s.heading}
                title="Tên phần"
                onChange={(e) =>
                  set({
                    sections: value.sections.map((x, i) =>
                      i === si ? { ...x, heading: e.target.value } : x,
                    ),
                  })
                }
              />
              <input
                type="text"
                value={s.setting}
                title="Bối cảnh"
                onChange={(e) =>
                  set({
                    sections: value.sections.map((x, i) =>
                      i === si ? { ...x, setting: e.target.value } : x,
                    ),
                  })
                }
              />
              <span className="muted small" style={{ alignSelf: "center" }}>
                Phần {si + 1}
              </span>
            </div>
            {s.lines.map((l, li) => {
              const mark = diff?.marks.get(`${si}:${li}`);
              const ghosts =
                diff?.removed.filter((r) => r.si === si && r.before === li) ??
                [];
              return (
                <div key={li} className="line-wrap">
                  {ghosts.map((g, gi) => (
                    <div key={`ghost-${gi}`} className="line-removed">
                      <span className="diff-tag">Đã xoá</span>
                      <span className="line-removed-text">{g.line.text}</span>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => restore(g)}
                      >
                        Khôi phục
                      </button>
                    </div>
                  ))}
                  <div
                    data-line={`${si}-${li}`}
                    className={[
                      "line",
                      mark ? `line-${mark.kind}` : "",
                      picked.has(`${si}:${li}`) ? "line-picked" : "",
                      dragging?.si === si && dragging.li === li
                        ? "line-dragging"
                        : "",
                      slot?.si === si && slot.index === li ? "drop-before" : "",
                      slot?.si === si &&
                      slot.index === li + 1 &&
                      li === s.lines.length - 1
                        ? "drop-after"
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
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
                        if (e.key === "Escape") return endDrag(false);
                        if (e.key !== "ArrowUp" && e.key !== "ArrowDown")
                          return;
                        e.preventDefault();
                        nudge(si, li, e.key === "ArrowUp" ? -1 : 1);
                      }}
                    >
                      <svg
                        width="12"
                        height="18"
                        viewBox="0 0 12 18"
                        aria-hidden="true"
                      >
                        {[3, 9].flatMap((x) =>
                          [3, 9, 15].map((y) => (
                            <circle
                              key={`${x}-${y}`}
                              cx={x}
                              cy={y}
                              r="1.6"
                              fill="currentColor"
                            />
                          )),
                        )}
                      </svg>
                    </button>
                    <select
                      value={l.speaker}
                      onChange={(e) =>
                        updateLine(si, li, { speaker: e.target.value })
                      }
                    >
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
                      onChange={(e) =>
                        updateLine(si, li, {
                          text: e.target.value,
                          ttsText: e.target.value,
                        })
                      }
                    />
                    <select
                      value={l.emotion}
                      onChange={(e) =>
                        updateLine(si, li, {
                          emotion: e.target.value as Emotion,
                        })
                      }
                    >
                      {Object.entries(EMOTIONS).map(([id, em]) => (
                        <option key={id} value={id}>
                          {em.label}
                        </option>
                      ))}
                    </select>
                    <div className="line-actions">
                      {onSelect ? (
                        <label
                          className="line-pick"
                          title="Chọn câu này để AI chỉ sửa những câu đã chọn"
                        >
                          <input
                            type="checkbox"
                            checked={picked.has(`${si}:${li}`)}
                            onChange={() => toggle(`${si}:${li}`)}
                          />
                        </label>
                      ) : null}
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
                        onChange={(e) =>
                          updateLine(si, li, { ttsText: e.target.value })
                        }
                      />
                    ) : null}
                    {showTts ? (
                      <input
                        className="line-tts"
                        type="text"
                        value={l.delivery ?? ""}
                        placeholder="Chỉ dẫn diễn xuất (tiếng Anh), ví dụ: gasp, rising tone of wonder"
                        title="Chỉ dẫn diễn xuất cho giọng đọc"
                        onChange={(e) =>
                          updateLine(si, li, { delivery: e.target.value })
                        }
                      />
                    ) : null}
                    {mark ? (
                      <div className="line-diff">
                        <span className="diff-tag">
                          {mark.kind === "changed" ? "Đã sửa" : "Câu mới"}
                        </span>
                        {mark.kind === "changed" ? (
                          <span className="line-diff-old">
                            Trước: {mark.old.text}
                          </span>
                        ) : null}
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() =>
                            mark.kind === "changed"
                              ? updateLine(si, li, mark.old)
                              : removeLine(si, li)
                          }
                        >
                          Hoàn tác
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
            {(
              diff?.removed.filter(
                (r) => r.si === si && r.before >= s.lines.length,
              ) ?? []
            ).map((g, gi) => (
              <div key={`ghost-end-${gi}`} className="line-removed">
                <span className="diff-tag">Đã xoá</span>
                <span className="line-removed-text">{g.line.text}</span>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => restore(g)}
                >
                  Khôi phục
                </button>
              </div>
            ))}
            <div className="line-add">
              <span className="muted small">Thêm câu cuối phần cho:</span>
              {value.characters.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="btn btn-sm"
                  onClick={() => insertLine(si, s.lines.length, c.id)}
                >
                  + {c.name}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <ListEditor
          label="Ghi nhớ cuối bài"
          items={value.recap}
          onChange={(recap) => set({ recap })}
        />
      </div>
    </div>
  );
}

function ListEditor({
  label,
  items,
  onChange,
}: {
  label: string;
  items: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <div className="field">
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>
        {label}
      </div>
      <div className="list-edit">
        {items.map((item, i) => (
          <div key={i} className="list-edit-row">
            <input
              type="text"
              value={item}
              onChange={(e) =>
                onChange(items.map((x, j) => (j === i ? e.target.value : x)))
              }
            />
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
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => onChange([...items, ""])}
          >
            + Thêm
          </button>
        </div>
      </div>
    </div>
  );
}
