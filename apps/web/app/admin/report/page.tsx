'use client';

import { useEffect, useMemo, useState } from 'react';
import { USAGE_STEP_LABELS, type UsageSummary } from '@edu/shared';
import { AdminOnly } from '@/components/Session';
import { api, formatTime, formatTokens, formatUsd, type LessonUsage } from '@/lib/api';

export default function ReportPage() {
  return (
    <AdminOnly>
      <Report />
    </AdminOnly>
  );
}

function sumCost(rows: { costUsd: number | null }[]) {
  return rows.reduce<number | null>((a, r) => (a === null || r.costUsd === null ? null : a + r.costUsd), 0);
}

function Report() {
  const [total, setTotal] = useState<UsageSummary | null>(null);
  const [lessons, setLessons] = useState<LessonUsage[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.totalUsage(), api.usageByLesson()])
      .then(([t, l]) => {
        setTotal(t);
        setLessons(l);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const byMember = useMemo(() => {
    const m = new Map<string, { name: string; lessons: number; tokens: number; costUsd: number | null }>();
    for (const l of lessons ?? []) {
      const key = l.lessonId === null ? '(deleted)' : (l.creatorId ?? '(none)');
      const name = l.lessonId === null ? 'Bài đã xoá' : (l.creatorName ?? 'Không rõ người tạo');
      const e = m.get(key) ?? { name, lessons: 0, tokens: 0, costUsd: 0 as number | null };
      e.lessons += l.lessonId ? 1 : 0;
      e.tokens += l.totalTokens;
      e.costUsd = e.costUsd === null || l.costUsd === null ? null : e.costUsd + l.costUsd;
      m.set(key, e);
    }
    return [...m.values()].sort((a, b) => (b.costUsd ?? 0) - (a.costUsd ?? 0));
  }, [lessons]);

  const real = (lessons ?? []).filter((l) => l.lessonId);
  const avg = real.length ? (sumCost(real) ?? 0) / real.length : null;

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Báo cáo chi phí</h1>
          <p className="muted small" style={{ margin: '4px 0 0' }}>
            Ước tính theo số token Gemini ghi nhận và bảng giá khai báo trong <code>GEMINI_PRICING</code>. Hoá đơn thật xem tại Google
            Cloud Billing.
          </p>
        </div>
      </div>
      {error ? <div className="alert alert-error">{error}</div> : null}
      {!total || !lessons ? (
        <p className="muted">Đang tải...</p>
      ) : (
        <>
          <div className="stat-grid">
            <div className="card stat">
              <span className="muted small">Tổng chi phí</span>
              <strong>
                {formatUsd(total.costUsd)}
                {total.pricingComplete ? '' : '+'}
              </strong>
            </div>
            <div className="card stat">
              <span className="muted small">Số bài học</span>
              <strong>{real.length}</strong>
            </div>
            <div className="card stat">
              <span className="muted small">Trung bình mỗi bài</span>
              <strong>{formatUsd(avg)}</strong>
            </div>
            <div className="card stat">
              <span className="muted small">Tổng token</span>
              <strong>{formatTokens(total.totalTokens)}</strong>
              <span className="muted small">{formatTokens(total.calls)} lượt gọi</span>
            </div>
          </div>

          <div className="grid-2">
            <div className="card table-card">
              <h2 style={{ marginBottom: 10 }}>Theo bài học</h2>
              {lessons.length === 0 ? (
                <p className="muted">Chưa có lượt gọi AI nào.</p>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Bài học</th>
                      <th>Người tạo</th>
                      <th className="num">Token</th>
                      <th className="num">Chi phí</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lessons.map((l) => (
                      <tr key={l.lessonId ?? 'deleted'}>
                        <td>
                          {l.lessonId ? <strong>{l.title}</strong> : <span className="muted">Các bài đã xoá</span>}
                          <div className="muted small">Lần gọi AI gần nhất {formatTime(l.lastAt)}</div>
                        </td>
                        <td className="small">{l.lessonId ? (l.creatorName ?? '—') : '—'}</td>
                        <td className="num">{formatTokens(l.totalTokens)}</td>
                        <td className="num">{formatUsd(l.costUsd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <aside>
              <div className="card">
                <h2 style={{ marginBottom: 10 }}>Theo thành viên</h2>
                <table className="usage-table">
                  <tbody>
                    {byMember.map((m) => (
                      <tr key={m.name}>
                        <td>
                          {m.name}
                          {m.lessons ? <div className="muted small">{m.lessons} bài</div> : null}
                        </td>
                        <td className="num">{formatUsd(m.costUsd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="card">
                <h2 style={{ marginBottom: 10 }}>Theo bước</h2>
                <table className="usage-table">
                  <tbody>
                    {total.byStep.map((s) => (
                      <tr key={s.step}>
                        <td>{USAGE_STEP_LABELS[s.step] ?? s.step}</td>
                        <td className="num muted">{formatTokens(s.totalTokens)}</td>
                        <td className="num">{formatUsd(s.costUsd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="card">
                <h2 style={{ marginBottom: 10 }}>Theo model</h2>
                <table className="usage-table">
                  <tbody>
                    {total.byModel.map((m) => (
                      <tr key={m.model}>
                        <td>
                          <code>{m.model}</code>
                          <div className="muted small">{m.calls} lượt</div>
                        </td>
                        <td className="num">{formatUsd(m.costUsd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </aside>
          </div>
        </>
      )}
    </main>
  );
}
