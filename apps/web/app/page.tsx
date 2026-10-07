'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
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
      <div>
        <section>
          <div className="page-head">
            <div>
              <h1>Bài học</h1>
              <p className="muted small" style={{ margin: '4px 0 0' }}>
                Bạn đưa ý tưởng, duyệt kịch bản và thành phẩm. Mọi bước còn lại do AI làm.
              </p>
            </div>
            <Link href="/new" className="btn btn-primary">
              ＋ Tạo bài học
            </Link>
          </div>
          {error ? <div className="alert alert-error">{error}</div> : null}
          {lessons === null ? (
            <div className="empty">Đang tải...</div>
          ) : lessons.length === 0 ? (
            <div className="card empty">
              Chưa có bài học nào. <Link href="/new">Tạo bài học đầu tiên</Link>.
            </div>
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
                      {l.creatorName ? `${l.creatorName} · ` : ''}Cập nhật {formatTime(l.updatedAt)}
                      {l.tokens ? ` · ${formatTokens(l.tokens)} token` : ''}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
