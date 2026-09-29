'use client';

import { useState } from 'react';
import { EMOTIONS, VOICES, type Emotion, type LessonScript, type ScriptLine } from '@edu/shared';

interface Props {
  value: LessonScript;
  onChange: (script: LessonScript) => void;
}

const ROLE_LABEL = { child: 'Trẻ em', adult: 'Người lớn', mascot: 'Linh vật', narrator: 'Người dẫn chuyện' } as const;

export function ScriptEditor({ value, onChange }: Props) {
  const [showTts, setShowTts] = useState(false);
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

  const addLine = (si: number) => {
    const section = value.sections[si];
    const last = section.lines[section.lines.length - 1];
    const line: ScriptLine = {
      speaker: last?.speaker ?? value.characters[0].id,
      text: '',
      ttsText: '',
      emotion: 'cheerful',
      visualNote: '',
    };
    set({ sections: value.sections.map((s, i) => (i !== si ? s : { ...s, lines: [...s.lines, line] })) });
  };

  return (
    <div>
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
          <h2>Kịch bản</h2>
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
              <div key={li} className="line">
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
                  onChange={(e) => updateLine(si, li, { text: e.target.value, ttsText: e.target.value })}
                />
                <select value={l.emotion} onChange={(e) => updateLine(si, li, { emotion: e.target.value as Emotion })}>
                  {Object.entries(EMOTIONS).map(([id, em]) => (
                    <option key={id} value={id}>
                      {em.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  title="Xoá câu"
                  disabled={s.lines.length <= 1}
                  onClick={() => removeLine(si, li)}
                >
                  ✕
                </button>
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
            <button type="button" className="btn btn-sm" onClick={() => addLine(si)}>
              + Thêm câu thoại
            </button>
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
