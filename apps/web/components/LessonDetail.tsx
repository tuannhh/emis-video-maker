'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PRODUCTION_STEPS, STEP_LABELS, type LessonEvent, type LessonScript } from '@edu/shared';
import { AudioCard } from '@/components/AudioCard';
import { ScriptEditor } from '@/components/ScriptEditor';
import { StatusBadge } from '@/components/StatusBadge';
import { UsageCard } from '@/components/UsageCard';
import { api, formatTime, slugFileName, type LessonPayload, type LessonView } from '@/lib/api';

/** Trang chi tiết bài học; `fetcher` lấy bài theo mã (URL mới) hoặc theo id (URL cũ). */
export function LessonDetail({ fetcher }: { fetcher: () => Promise<LessonPayload> }) {
  const router = useRouter();
  const [lesson, setLesson] = useState<LessonView | null>(null);
  const [events, setEvents] = useState<LessonEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetcher();
      setLesson(data.lesson);
      setEvents(data.events);
      setError(null);
      // Tên bài đổi (sau khi AI viết kịch bản) thì cập nhật URL chuẩn /{môn}/{lớp}/{tên-bài}/{mã}
      if (window.location.pathname !== data.lesson.path) window.history.replaceState(null, '', data.lesson.path);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [fetcher]);

  const busy = lesson?.status === 'generating_script' || lesson?.status === 'producing';
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(load, 2500);
    return () => clearInterval(t);
  }, [busy, load]);

  if (!lesson) {
    return <main className="page">{error ? <div className="alert alert-error">{error}</div> : 'Đang tải...'}</main>;
  }

  async function remove() {
    if (!confirm('Xoá bài học này? Video và kịch bản sẽ mất.')) return;
    try {
      await api.deleteLesson(lesson!.id);
      router.push('/');
    } catch (e) {
      alert((e as Error).message);
    }
  }

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <a href="/" className="small">
            ← Tất cả bài học
          </a>
          <h1 style={{ marginTop: 6 }}>{lesson.title}</h1>
          <div className="actions" style={{ marginTop: 6 }}>
            <StatusBadge status={lesson.status} />
            <span className="muted small">
              {lesson.idea.subject} · {lesson.idea.grade} · khoảng {lesson.idea.durationSec} giây
            </span>
          </div>
        </div>
        {!busy ? (
          <button className="btn btn-danger btn-sm" onClick={remove}>
            Xoá bài học
          </button>
        ) : null}
      </div>
      {error ? <div className="alert alert-error">{error}</div> : null}

      {lesson.status === 'script_review' && lesson.script ? (
        <>
          <ScriptReview lesson={lesson} script={lesson.script} onDone={load} />
          <div className="grid-2" style={{ marginTop: 16 }}>
            <AudioCard lesson={lesson} onSaved={load} />
            <UsageCard lesson={lesson} />
          </div>
        </>
      ) : (
        <div className="grid-2">
          <div>
            {lesson.status === 'generating_script' ? <Working title="AI đang viết kịch bản..." lesson={lesson} /> : null}
            {lesson.status === 'producing' ? <Production lesson={lesson} /> : null}
            {lesson.status === 'failed' ? <Failed lesson={lesson} onDone={load} /> : null}
            {(lesson.status === 'final_review' || lesson.status === 'approved') && lesson.urls ? (
              <FinalReview lesson={lesson} onDone={load} />
            ) : null}
          </div>
          <aside>
            {lesson.status !== 'generating_script' ? <AudioCard lesson={lesson} onSaved={load} /> : null}
            <UsageCard lesson={lesson} />
            <div className="card">
              <h2 style={{ marginBottom: 10 }}>Nhật ký</h2>
              <EventLog events={events} />
            </div>
            <div className="card">
              <h2 style={{ marginBottom: 10 }}>Ý tưởng ban đầu</h2>
              <p style={{ margin: 0 }}>{lesson.idea.topic}</p>
              {lesson.idea.notes ? <p className="muted small">{lesson.idea.notes}</p> : null}
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}

function Working({ title, lesson }: { title: string; lesson: LessonView }) {
  return (
    <div className="card">
      <div className="actions" style={{ marginBottom: 12 }}>
        <span className="spinner" style={{ color: 'var(--primary)' }} />
        <h2>{title}</h2>
      </div>
      <div className="progress">
        <div style={{ width: `${Math.max(8, lesson.progress)}%` }} />
      </div>
      <p className="muted small">Thường mất 15–40 giây. Trang tự cập nhật.</p>
    </div>
  );
}

function Production({ lesson }: { lesson: LessonView }) {
  const currentIdx = PRODUCTION_STEPS.indexOf(lesson.step as (typeof PRODUCTION_STEPS)[number]);
  return (
    <div className="card">
      <div className="card-head">
        <h2>AI đang sản xuất video</h2>
        <strong>{lesson.progress}%</strong>
      </div>
      <div className="progress">
        <div style={{ width: `${lesson.progress}%` }} />
      </div>
      <div className="steps">
        {PRODUCTION_STEPS.map((s, i) => {
          const state = i < currentIdx ? 'done' : i === currentIdx ? 'current' : '';
          return (
            <div key={s} className={`step ${state}`}>
              <span className="step-icon">{state === 'done' ? '✓' : state === 'current' ? <span className="spinner" /> : i + 1}</span>
              {STEP_LABELS[s]}
            </div>
          );
        })}
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        Bạn có thể rời trang, quá trình vẫn chạy nền. Bài học mới cần vẽ nhân vật và bối cảnh nên lâu hơn; các bài sau dùng lại thư viện
        sẽ nhanh hơn.
      </p>
    </div>
  );
}

function Failed({ lesson, onDone }: { lesson: LessonView; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="card">
      <h2 style={{ marginBottom: 12 }}>Có lỗi xảy ra</h2>
      <div className="alert alert-error" style={{ whiteSpace: 'pre-wrap' }}>
        {lesson.step ? `Bước "${STEP_LABELS[lesson.step]}": ` : ''}
        {lesson.error}
      </div>
      <button
        className="btn btn-primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api.retry(lesson.id);
          } catch (e) {
            alert((e as Error).message);
          }
          onDone();
        }}
      >
        Chạy lại từ bước bị lỗi
      </button>
      <p className="muted small">Những phần đã làm xong (nhân vật, bối cảnh, giọng đọc) được giữ lại, không tốn thêm lượt gọi AI.</p>
    </div>
  );
}

function ScriptReview({ lesson, script, onDone }: { lesson: LessonView; script: LessonScript; onDone: () => void }) {
  const [draft, setDraft] = useState(script);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setMsg(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setMsg({ tone: 'error', text: (e as Error).message });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const save = () =>
    run('save', async () => {
      await api.saveScript(lesson.id, draft);
      setDirty(false);
      setMsg({ tone: 'ok', text: 'Đã lưu thay đổi' });
    });

  const approve = async () => {
    const ok = await run('approve', async () => {
      if (dirty) await api.saveScript(lesson.id, draft);
      await api.approveScript(lesson.id);
    });
    if (ok) onDone();
  };

  const regenerate = async () => {
    const ok = await run('regen', () => api.regenerateScript(lesson.id, feedback.trim()));
    if (ok) {
      setFeedbackOpen(false);
      onDone();
    }
  };

  return (
    <>
      {lesson.feedback ? (
        <div className="alert alert-info">
          <strong>Góp ý lần trước:</strong> {lesson.feedback}
        </div>
      ) : null}
      {msg ? <div className={`alert alert-${msg.tone === 'ok' ? 'ok' : 'error'}`}>{msg.text}</div> : null}
      <ScriptEditor
        value={draft}
        onChange={(s) => {
          setDraft(s);
          setDirty(true);
        }}
      />
      <div className="sticky-bar">
        <span className="muted small">
          {dirty ? 'Có thay đổi chưa lưu' : 'Kiểm tra nội dung rồi duyệt để AI sản xuất video'}
        </span>
        <div className="actions">
          <button className="btn" onClick={() => setFeedbackOpen(true)} disabled={!!busy}>
            Yêu cầu AI viết lại
          </button>
          <button className="btn" onClick={save} disabled={!dirty || !!busy}>
            {busy === 'save' ? <span className="spinner" /> : null} Lưu
          </button>
          <button className="btn btn-success" onClick={approve} disabled={!!busy}>
            {busy === 'approve' ? <span className="spinner" /> : null} Duyệt kịch bản & sản xuất video
          </button>
        </div>
      </div>
      {feedbackOpen ? (
        <Modal title="Yêu cầu AI viết lại kịch bản" onClose={() => setFeedbackOpen(false)}>
          <label className="field">
            <span>Góp ý cho AI</span>
            <textarea
              rows={4}
              autoFocus
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="Ví dụ: thêm một câu hỏi để học sinh tự đếm, bớt lời mẹ, đổi bối cảnh sang lớp học"
            />
          </label>
          <div className="actions" style={{ justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => setFeedbackOpen(false)}>
              Huỷ
            </button>
            <button className="btn btn-primary" disabled={feedback.trim().length < 3 || !!busy} onClick={regenerate}>
              {busy === 'regen' ? <span className="spinner" /> : null} Viết lại
            </button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

function FinalReview({ lesson, onDone }: { lesson: LessonView; onDone: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [mode, setMode] = useState<'video' | 'script'>('video');
  const [busy, setBusy] = useState(false);
  const urls = lesson.urls!;
  const name = slugFileName(lesson.title);
  const qa = lesson.qa;
  const approved = lesson.status === 'approved';

  const seek = (t: number) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = t;
    void videoRef.current.play();
  };

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      setRejectOpen(false);
      onDone();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="card">
        <video ref={videoRef} className="player" src={urls.video} poster={urls.thumbnail} controls preload="metadata" />
        <div className="card-head" style={{ marginTop: 16, marginBottom: 0 }}>
          <span className="muted small">
            Thời lượng {lesson.output?.durationSec}s · render lúc {lesson.output ? formatTime(lesson.output.renderedAt) : ''}
          </span>
          <div className="downloads">
            <a className="btn btn-sm" href={`${urls.video}?download=${name}.mp4`}>
              ⬇ Video MP4
            </a>
            <a className="btn btn-sm" href={`${urls.srt}?download=${name}.srt`}>
              ⬇ Phụ đề SRT
            </a>
            <a className="btn btn-sm" href={`${urls.thumbnail}?download=${name}.jpg`}>
              ⬇ Ảnh thumbnail
            </a>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>AI tự kiểm tra</h2>
          {qa ? (
            <span className={`badge badge-${qa.verdict === 'pass' ? 'ok' : qa.verdict === 'warn' ? 'warn' : 'err'}`}>
              {qa.verdict === 'pass' ? 'Đạt' : qa.verdict === 'warn' ? 'Có lỗi nhỏ' : 'Cần làm lại'}
            </span>
          ) : (
            <span className="badge badge-muted">Không có kết quả</span>
          )}
        </div>
        {qa ? (
          <>
            <p style={{ marginTop: 0 }}>{qa.summary}</p>
            {qa.issues.map((iss, i) => (
              <div key={i} className="qa-issue">
                <button className="qa-time" onClick={() => seek(iss.timeSec)}>
                  {Math.floor(iss.timeSec / 60)}:{String(Math.floor(iss.timeSec % 60)).padStart(2, '0')}
                </button>
                <span
                  className={`badge badge-${iss.severity === 'high' ? 'err' : iss.severity === 'medium' ? 'warn' : 'muted'}`}
                >
                  {iss.severity === 'high' ? 'Nặng' : iss.severity === 'medium' ? 'Vừa' : 'Nhẹ'}
                </span>
                <span>{iss.description}</span>
              </div>
            ))}
          </>
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            AI chưa kiểm tra được video này, hãy xem kỹ trước khi duyệt.
          </p>
        )}
      </div>

      {approved ? (
        <div className="alert alert-ok" style={{ marginTop: 16 }}>
          Thành phẩm đã được duyệt. Tải video, phụ đề và thumbnail ở trên để đăng lên các kênh mạng xã hội.
        </div>
      ) : null}
      <div className="sticky-bar">
        <span className="muted small">{approved ? 'Cần sửa? Bạn vẫn có thể yêu cầu làm lại.' : 'Xem hết video rồi duyệt hoặc yêu cầu làm lại.'}</span>
        <div className="actions">
          <button className="btn btn-danger" onClick={() => setRejectOpen(true)} disabled={busy}>
            Yêu cầu làm lại
          </button>
          {!approved ? (
            <button className="btn btn-success" disabled={busy} onClick={() => act(() => api.approveFinal(lesson.id))}>
              Duyệt thành phẩm
            </button>
          ) : null}
        </div>
      </div>

      {rejectOpen ? (
        <Modal title="Yêu cầu làm lại" onClose={() => setRejectOpen(false)}>
          <div
            className={`radio-card ${mode === 'video' ? 'selected' : ''}`}
            onClick={() => setMode('video')}
          >
            <input type="radio" checked={mode === 'video'} readOnly />
            <div>
              <strong>Dựng lại video</strong>
              <div className="muted small">Giữ kịch bản, AI dàn dựng lại cảnh, camera, nhãn theo góp ý</div>
            </div>
          </div>
          <div
            className={`radio-card ${mode === 'script' ? 'selected' : ''}`}
            onClick={() => setMode('script')}
          >
            <input type="radio" checked={mode === 'script'} readOnly />
            <div>
              <strong>Sửa kịch bản</strong>
              <div className="muted small">AI viết lại kịch bản theo góp ý, bạn duyệt lại trước khi sản xuất</div>
            </div>
          </div>
          <label className="field" style={{ marginTop: 12 }}>
            <span>Góp ý</span>
            <textarea
              rows={4}
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="Ví dụ: ở giây 0:25 camera nên phóng to vào giỏ trái cây, nhãn số 0 bị lệch"
            />
          </label>
          <div className="actions" style={{ justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => setRejectOpen(false)}>
              Huỷ
            </button>
            <button
              className="btn btn-primary"
              disabled={feedback.trim().length < 3 || busy}
              onClick={() => act(() => api.rejectFinal(lesson.id, feedback.trim(), mode))}
            >
              Gửi yêu cầu
            </button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

function EventLog({ events }: { events: LessonEvent[] }) {
  if (!events.length) return <p className="muted small">Chưa có hoạt động.</p>;
  return (
    <ul className="events">
      {events.map((e) => (
        <li key={e.id}>
          <time>{formatTime(e.createdAt)}</time>
          <span className={e.type === 'error' ? 'error' : ''}>{e.message}</span>
        </li>
      ))}
    </ul>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}
