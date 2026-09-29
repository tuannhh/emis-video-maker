import type { LessonStatus } from '@edu/shared';
import { STATUS_META } from '@/lib/api';

export function StatusBadge({ status }: { status: LessonStatus }) {
  const meta = STATUS_META[status];
  return (
    <span className={`badge badge-${meta.tone}`}>
      <span className={`dot ${meta.busy ? 'pulse' : ''}`} />
      {meta.label}
    </span>
  );
}
