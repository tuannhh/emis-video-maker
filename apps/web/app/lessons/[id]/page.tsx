'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

/** URL cũ /lessons/{id}: chuyển sang URL chuẩn /{môn}/{lớp}/{tên-bài}/{mã} */
export default function LegacyLessonPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api
      .getLesson(id)
      .then((d) => router.replace(d.lesson.path))
      .catch((e: Error) => setError(e.message));
  }, [id, router]);
  return <main className="page">{error ? <div className="alert alert-error">{error}</div> : 'Đang chuyển trang...'}</main>;
}
