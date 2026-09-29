'use client';

import { useEffect, useState } from 'react';
import { USAGE_STEP_LABELS, type UsageSummary } from '@edu/shared';
import { api, formatTokens, formatUsd, type LessonView } from '@/lib/api';

const MODALITY: Record<string, string> = { TEXT: 'chữ', IMAGE: 'ảnh', AUDIO: 'âm thanh', VIDEO: 'video' };

function modalities(m: Record<string, number>) {
  return Object.entries(m)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${MODALITY[k] ?? k.toLowerCase()} ${formatTokens(v)}`)
    .join(' · ');
}

/** Token Gemini đã dùng cho bài học (cộng dồn mọi lần tạo và làm lại) — dùng để tính chi phí */
export function UsageCard({ lesson }: { lesson: LessonView }) {
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    api
      .usage(lesson.id)
      .then((u) => {
        setUsage(u);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [lesson.id, lesson.updatedAt, lesson.progress]);

  return (
    <div className="card">
      <div className="card-head">
        <h2>Token Gemini</h2>
        {usage && usage.costUsd !== null ? (
          <span className="badge badge-info" title={usage.pricingComplete ? '' : 'Một số model chưa khai báo giá'}>
            ≈ {formatUsd(usage.costUsd)}
            {usage.pricingComplete ? '' : '+'}
          </span>
        ) : null}
      </div>
      {error ? <div className="alert alert-error">{error}</div> : null}
      {!usage ? (
        <p className="muted small">Đang tải...</p>
      ) : usage.calls === 0 ? (
        <p className="muted small" style={{ margin: 0 }}>
          Chưa có lượt gọi AI nào được ghi nhận cho bài này.
        </p>
      ) : (
        <>
          <div className="usage-total">
            <strong>{formatTokens(usage.totalTokens)}</strong>
            <span className="muted small">token · {usage.calls} lượt gọi</span>
          </div>
          <div className="usage-split small muted">
            Đầu vào {formatTokens(usage.promptTokens)} · đầu ra {formatTokens(usage.outputTokens)}
            {usage.thoughtsTokens ? ` · suy luận ${formatTokens(usage.thoughtsTokens)}` : ''}
          </div>
          <table className="usage-table">
            <tbody>
              {usage.byStep.map((s) => (
                <tr key={s.step}>
                  <td>{USAGE_STEP_LABELS[s.step] ?? s.step}</td>
                  <td className="num">{formatTokens(s.totalTokens)}</td>
                  <td className="num muted">{s.calls} lượt</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="btn btn-ghost btn-sm" onClick={() => setOpen((v) => !v)} style={{ marginTop: 6 }}>
            {open ? 'Ẩn chi tiết theo model' : 'Chi tiết theo model'}
          </button>
          {open ? (
            <div className="usage-models">
              {usage.byModel.map((m) => (
                <div key={m.model} className="usage-model">
                  <div className="actions" style={{ justifyContent: 'space-between' }}>
                    <code>{m.model}</code>
                    <span>
                      {formatTokens(m.totalTokens)} {m.costUsd !== null ? <span className="muted">· {formatUsd(m.costUsd)}</span> : null}
                    </span>
                  </div>
                  <div className="muted small">
                    Vào: {modalities(m.input) || formatTokens(m.promptTokens)} — Ra: {modalities(m.output) || formatTokens(m.outputTokens)}
                    {m.thoughtsTokens ? ` — Suy luận: ${formatTokens(m.thoughtsTokens)}` : ''} — {m.calls} lượt
                  </div>
                </div>
              ))}
              {!usage.pricingComplete ? (
                <p className="muted small" style={{ marginBottom: 0 }}>
                  Khai báo giá từng model trong biến môi trường <code>GEMINI_PRICING</code> để hệ thống tự tính chi phí.
                </p>
              ) : null}
            </div>
          ) : null}
        </>
      )}
      <p className="muted small" style={{ margin: '10px 0 0' }}>
        Cộng dồn mọi lần tạo, viết lại và dựng lại. Nhân vật/bối cảnh/giọng đọc dùng lại từ thư viện không tốn thêm token.
      </p>
    </div>
  );
}
