'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_AUDIO, GRADES, SUBJECTS } from '@edu/shared';
import { StatusBadge } from '@/components/StatusBadge';
import { api, formatTime, formatTokens, STATUS_META, type LessonView } from '@/lib/api';

export default function HomePage() {
  const [lessons, setLessons] = useState<LessonView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.listLessons().then(setLessons).catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <main className="page">
      <div className="grid-2">
        <section>
          <div className="page-head">
            <div>
              <h1>Bài học</h1>
              <p className="muted small" style={{ margin: '4px 0 0' }}>
                Bạn đưa ý tưởng, duyệt kịch bản và thành phẩm. Mọi bước còn lại do AI làm.
              </p>
            </div>
          </div>
          {error ? <div className="alert alert-error">{error}</div> : null}
          {lessons === null ? (
            <div className="empty">Đang tải...</div>
          ) : lessons.length === 0 ? (
            <div className="card empty">Chưa có bài học nào. Hãy nhập ý tưởng đầu tiên ở khung bên cạnh.</div>
          ) : (
            <div className="lesson-list">
              {lessons.map((l) => (
                <Link key={l.id} href={l.path} className="lesson-card">
                  <div className="thumb">
                    {l.urls?.thumbnail ? <img src={l.urls.thumbnail} alt="" /> : <span>{STATUS_META[l.status].label}</span>}
                  </div>
                  <div className="lesson-card-body">
                    <h3>{l.title}</h3>
                    <div className="actions" style={{ justifyContent: 'space-between' }}>
                      <StatusBadge status={l.status} />
                      <span className="muted small">
                        {l.idea.subject} · {l.idea.grade}
                      </span>
                    </div>
                    <div className="muted small" style={{ marginTop: 6 }}>
                      Cập nhật {formatTime(l.updatedAt)}
                      {l.tokens ? ` · ${formatTokens(l.tokens)} token` : ''}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
        <aside>
          <CreateLessonCard />
        </aside>
      </div>
    </main>
  );
}

function CreateLessonCard() {
  const router = useRouter();
  const [topic, setTopic] = useState('');
  const [subject, setSubject] = useState('Toán');
  const [grade, setGrade] = useState('Lớp 1');
  const [durationSec, setDuration] = useState(90);
  const [notes, setNotes] = useState('');
  const [burnSubtitles, setBurnSubtitles] = useState(true);
  const [withMusic, setWithMusic] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      });
      router.push(lesson.path);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <h2 style={{ marginBottom: 14 }}>Tạo bài học mới</h2>
      {error ? <div className="alert alert-error">{error}</div> : null}
      <label className="field">
        <span>Ý tưởng bài học</span>
        <textarea
          required
          minLength={3}
          rows={4}
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
      </div>
      <label className="field">
        <span>Thời lượng: khoảng {durationSec} giây</span>
        <input
          type="range"
          min={30}
          max={240}
          step={15}
          value={durationSec}
          onChange={(e) => setDuration(Number(e.target.value))}
          style={{ width: '100%' }}
        />
      </label>
      <label className="field">
        <span>Yêu cầu thêm (không bắt buộc)</span>
        <textarea
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Ví dụ: có câu hỏi cho học sinh trả lời, dùng nhân vật bé Nam"
        />
      </label>
      <label className="actions small" style={{ marginBottom: 16 }}>
        <input type="checkbox" checked={burnSubtitles} onChange={(e) => setBurnSubtitles(e.target.checked)} />
        Hiện phụ đề trong video
      </label>
      <label className="actions small" style={{ marginBottom: 16 }}>
        <input type="checkbox" checked={withMusic} onChange={(e) => setWithMusic(e.target.checked)} />
        Chèn nhạc nền (chỉnh âm lượng, đổi bản nhạc sau khi tạo)
      </label>
      <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy || topic.trim().length < 3}>
        {busy ? <span className="spinner" /> : null} Tạo kịch bản bằng AI
      </button>
    </form>
  );
}
