'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_AUDIO,
  GRADES,
  MAX_CHOSEN_BACKGROUNDS,
  MAX_CHOSEN_CHARACTERS,
  SUBJECTS,
  VOICES,
  type UploadView,
} from '@edu/shared';
import { CharacterCreator, Modal } from '@/components/CharacterCreator';
import { ImageField, MaterialsField, usePasteImages } from '@/components/Uploads';
import { api, type AssetView } from '@/lib/api';

export default function NewLessonPage() {
  const router = useRouter();
  const [topic, setTopic] = useState('');
  const [subject, setSubject] = useState('Toán');
  const [grade, setGrade] = useState('Lớp 1');
  const [durationSec, setDuration] = useState(90);
  const [notes, setNotes] = useState('');
  const [burnSubtitles, setBurnSubtitles] = useState(true);
  const [withMusic, setWithMusic] = useState(true);

  const [materials, setMaterials] = useState<UploadView[]>([]);
  const addMaterials = useRef<((files: File[]) => void) | null>(null);
  const [styleRef, setStyleRef] = useState<UploadView | null>(null);

  const [assets, setAssets] = useState<AssetView[] | null>(null);
  const [chars, setChars] = useState<string[]>([]);
  const [mascot, setMascot] = useState<string | null>(null);
  const [newCharacters, setNewCharacters] = useState(true);
  const [bgs, setBgs] = useState<string[]>([]);
  const [newBackgrounds, setNewBackgrounds] = useState(true);
  const [creator, setCreator] = useState<null | 'mascot' | 'design'>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAssets = useCallback(() => api.listAssets().then(setAssets).catch(() => setAssets([])), []);
  useEffect(() => {
    void loadAssets();
  }, [loadAssets]);

  // Ctrl+V ảnh ở bất kỳ đâu trên trang = thêm vào tư liệu
  usePasteImages((files) => {
    if (!creator) addMaterials.current?.(files);
  });

  const characters = assets?.filter((a) => a.kind === 'character') ?? [];
  const backgrounds = assets?.filter((a) => a.kind === 'background') ?? [];

  function toggleChar(key: string) {
    setChars((cur) => {
      if (cur.includes(key)) {
        if (mascot === key) setMascot(null);
        return cur.filter((k) => k !== key);
      }
      return cur.length >= MAX_CHOSEN_CHARACTERS ? cur : [...cur, key];
    });
  }
  const toggleBg = (key: string) =>
    setBgs((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : cur.length >= MAX_CHOSEN_BACKGROUNDS ? cur : [...cur, key]));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const lesson = await api.createLesson({
        topic: topic.trim(),
        subject,
        grade,
        durationSec,
        notes: notes.trim() || undefined,
        burnSubtitles,
        audio: { ...DEFAULT_AUDIO, musicId: withMusic ? 'auto' : null },
        materialIds: materials.map((m) => m.id),
        characterKeys: chars,
        mascotKey: mascot ?? undefined,
        newCharacters: chars.length ? newCharacters : true,
        backgroundKeys: bgs,
        newBackgrounds: bgs.length ? newBackgrounds : true,
        styleRefId: styleRef?.id,
      });
      router.push(lesson.path);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const voiceTone = (id?: string) => VOICES.find((v) => v.id === id)?.tone ?? id;
  const reusedChars = chars.length;
  const reusedBgs = bgs.length;

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <a href="/" className="small">
            ← Tất cả bài học
          </a>
          <h1 style={{ marginTop: 6 }}>Tạo bài học mới</h1>
        </div>
      </div>
      <form className="grid-2" onSubmit={submit}>
        <div>
          <section className="card">
            <h2 style={{ marginBottom: 14 }}>1. Ý tưởng bài học</h2>
            <label className="field">
              <span>Ý tưởng / chủ đề</span>
              <textarea
                required
                minLength={3}
                maxLength={500}
                rows={3}
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="Ví dụ: Làm quen với số 0 qua tình huống giỏ trái cây đã ăn hết ở nhà bếp"
              />
            </label>
            <div className="row">
              <label className="field">
                <span>Môn học</span>
                <select value={subject} onChange={(e) => setSubject(e.target.value)}>
                  {SUBJECTS.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Lớp</span>
                <select value={grade} onChange={(e) => setGrade(e.target.value)}>
                  {GRADES.map((g) => (
                    <option key={g}>{g}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Thời lượng: khoảng {durationSec} giây</span>
                <input
                  type="range"
                  min={30}
                  max={240}
                  step={15}
                  value={durationSec}
                  onChange={(e) => setDuration(Number(e.target.value))}
                  style={{ width: '100%', marginTop: 10 }}
                />
              </label>
            </div>
            <label className="field" style={{ marginBottom: 0 }}>
              <span>Yêu cầu thêm (không bắt buộc)</span>
              <textarea
                rows={2}
                maxLength={2000}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Ví dụ: có câu hỏi cho học sinh trả lời, giọng dí dỏm"
              />
            </label>
          </section>

          <section className="card">
            <div className="card-head">
              <h2>2. Tư liệu tham khảo</h2>
              <span className="badge badge-muted">Không bắt buộc</span>
            </div>
            <p className="muted small" style={{ marginTop: 0 }}>
              Tải sách giáo khoa, phiếu bài tập, giáo án... AI đọc nội dung (kể cả chữ trong ảnh) và soạn kịch bản bám theo tư liệu.
              Không có tư liệu thì AI tự soạn nội dung theo chương trình.
            </p>
            <MaterialsField value={materials} onChange={setMaterials} addRef={addMaterials} />
          </section>

          <section className="card">
            <div className="card-head">
              <h2>3. Nhân vật</h2>
              <div className="actions">
                <button type="button" className="btn btn-sm" onClick={() => setCreator('mascot')}>
                  ＋ Tải mascot
                </button>
                <button type="button" className="btn btn-sm" onClick={() => setCreator('design')}>
                  ＋ AI tạo nhân vật
                </button>
              </div>
            </div>
            <p className="muted small" style={{ marginTop: 0 }}>
              Chọn tối đa {MAX_CHOSEN_CHARACTERS} nhân vật có sẵn để dùng lại (không tốn chi phí vẽ). Bấm ★ để chọn mascot dẫn dắt cả video.
              Không chọn thì AI tự chọn hoặc vẽ nhân vật phù hợp.
            </p>
            {assets === null ? (
              <p className="muted">Đang tải thư viện...</p>
            ) : characters.length === 0 ? (
              <p className="muted">Thư viện chưa có nhân vật.</p>
            ) : (
              <div className="pick-grid">
                {characters.map((a) => {
                  const on = chars.includes(a.key);
                  return (
                    <div key={a.id} className={`pick${on ? ' on' : ''}`}>
                      <button type="button" className="pick-main" onClick={() => toggleChar(a.key)} aria-pressed={on}>
                        <div className="asset-img">
                          <img src={a.urls.idle ?? a.urls.source ?? a.urls.base} alt={a.name} loading="lazy" />
                        </div>
                        <div className="pick-body">
                          <strong>{a.name}</strong>
                          <span className="muted small">{voiceTone(a.meta.voice)}</span>
                        </div>
                      </button>
                      {on ? (
                        <button
                          type="button"
                          className={`pick-star${mascot === a.key ? ' on' : ''}`}
                          title="Mascot dẫn dắt video"
                          onClick={() => setMascot(mascot === a.key ? null : a.key)}
                        >
                          ★ {mascot === a.key ? 'Mascot' : 'Chọn làm mascot'}
                        </button>
                      ) : null}
                      {a.meta.origin === 'upload' ? <span className="pick-tag">Mascot</span> : null}
                    </div>
                  );
                })}
              </div>
            )}
            {chars.length ? (
              <label className="actions small" style={{ marginTop: 12 }}>
                <input type="checkbox" checked={!newCharacters} onChange={(e) => setNewCharacters(!e.target.checked)} />
                Chỉ dùng {chars.length === 1 ? 'nhân vật này' : 'các nhân vật đã chọn'} (AI không thêm nhân vật mới
                {chars.length === 1 ? ', nhân vật nói chuyện trực tiếp với học sinh' : ''})
              </label>
            ) : null}
          </section>

          <section className="card">
            <h2 style={{ marginBottom: 6 }}>4. Bối cảnh</h2>
            <p className="muted small" style={{ marginTop: 0 }}>
              Chọn tối đa {MAX_CHOSEN_BACKGROUNDS} bối cảnh có sẵn để dùng lại. Không chọn thì AI tự chọn hoặc vẽ bối cảnh hợp nội dung.
            </p>
            {assets === null ? null : backgrounds.length === 0 ? (
              <p className="muted">Thư viện chưa có bối cảnh.</p>
            ) : (
              <div className="pick-grid wide">
                {backgrounds.map((a) => {
                  const on = bgs.includes(a.key);
                  return (
                    <div key={a.id} className={`pick${on ? ' on' : ''}`}>
                      <button type="button" className="pick-main" onClick={() => toggleBg(a.key)} aria-pressed={on} title={a.description}>
                        <div className="asset-img">
                          <img src={a.urls.image} alt={a.key} loading="lazy" />
                        </div>
                        <div className="pick-body">
                          <span className="small">{a.key}</span>
                        </div>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            {bgs.length ? (
              <label className="actions small" style={{ marginTop: 12 }}>
                <input type="checkbox" checked={!newBackgrounds} onChange={(e) => setNewBackgrounds(!e.target.checked)} />
                Chỉ dùng các bối cảnh đã chọn (không vẽ bối cảnh mới — tiết kiệm nhất)
              </label>
            ) : null}
          </section>

          <section className="card">
            <div className="card-head">
              <h2>5. Phong cách hình ảnh</h2>
              <span className="badge badge-muted">Không bắt buộc</span>
            </div>
            <p className="muted small" style={{ marginTop: 0 }}>
              Tải một ảnh mẫu (ví dụ khung hình video cũ, tranh minh hoạ 3D...): nhân vật và bối cảnh AI vẽ mới sẽ theo phong cách của ảnh
              này. Nhân vật, bối cảnh chọn từ thư viện giữ nguyên hình đã có.
            </p>
            <ImageField kind="style" value={styleRef} onChange={setStyleRef} label="Ảnh tham chiếu phong cách" />
          </section>
        </div>

        <aside className="sticky-aside">
          <div className="card">
            <h2 style={{ marginBottom: 12 }}>Tạo kịch bản</h2>
            {error ? <div className="alert alert-error">{error}</div> : null}
            <ul className="summary">
              <li>{materials.length ? `${materials.length} tư liệu tham khảo` : 'AI tự soạn nội dung'}</li>
              <li>
                {reusedChars ? `Dùng lại ${reusedChars} nhân vật` : 'AI tự chọn nhân vật'}
                {mascot ? ` · mascot ${characters.find((c) => c.key === mascot)?.name}` : ''}
                {reusedChars && !newCharacters ? ' · không thêm nhân vật mới' : ''}
              </li>
              <li>
                {reusedBgs ? `Dùng lại ${reusedBgs} bối cảnh` : 'AI tự chọn bối cảnh'}
                {reusedBgs && !newBackgrounds ? ' · không vẽ bối cảnh mới' : ''}
              </li>
              <li>{styleRef ? 'Vẽ theo ảnh phong cách đã tải' : 'Phong cách hoạt hình 2D mặc định'}</li>
            </ul>
            <label className="actions small" style={{ marginBottom: 10 }}>
              <input type="checkbox" checked={burnSubtitles} onChange={(e) => setBurnSubtitles(e.target.checked)} />
              Hiện phụ đề trong video
            </label>
            <label className="actions small" style={{ marginBottom: 16 }}>
              <input type="checkbox" checked={withMusic} onChange={(e) => setWithMusic(e.target.checked)} />
              Chèn nhạc nền
            </label>
            <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy || topic.trim().length < 3}>
              {busy ? <span className="spinner" /> : null} Tạo kịch bản bằng AI
            </button>
            <p className="muted small" style={{ marginBottom: 0 }}>
              Mỗi nhân vật vẽ mới tốn khoảng 8 ảnh (~$0.8), mỗi bối cảnh mới 1–3 ảnh (~$0.1–0.3). Dùng lại từ thư viện thì không tốn chi phí
              vẽ.
            </p>
          </div>
        </aside>
      </form>

      {creator ? (
        <Modal title="Thêm nhân vật vào thư viện" onClose={() => setCreator(null)}>
          <CharacterCreator
            initialMode={creator}
            context={{ topic: topic.trim() || undefined, subject, grade }}
            styleId={styleRef?.id}
            onCancel={() => setCreator(null)}
            onCreated={async (asset, mode) => {
              setCreator(null);
              await loadAssets();
              setChars((cur) => (cur.includes(asset.key) ? cur : [...cur, asset.key].slice(-MAX_CHOSEN_CHARACTERS)));
              if (mode === 'mascot') setMascot(asset.key);
            }}
          />
        </Modal>
      ) : null}
    </main>
  );
}
