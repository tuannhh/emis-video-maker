'use client';

import { useParams } from 'next/navigation';
import { useCallback } from 'react';
import { LessonDetail } from '@/components/LessonDetail';
import { api } from '@/lib/api';

/** /{môn}/{lớp}/{tên-bài}/{mã}, ví dụ /toan/lop-1/lam-quen-voi-so-10/1122ab — bài được tìm theo mã 6 ký tự */
export default function LessonByPathPage() {
  const { code } = useParams<{ code: string }>();
  const fetcher = useCallback(() => api.getLessonByCode(code), [code]);
  return <LessonDetail fetcher={fetcher} />;
}
