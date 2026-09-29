import crypto from 'node:crypto';

/** Chạy danh sách việc với số lượng song song giới hạn, giữ thứ tự kết quả. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

export function sha1(...parts: string[]) {
  return crypto.createHash('sha1').update(parts.join('\u0000')).digest('hex');
}

export type Progress = (percent: number, message?: string) => Promise<void>;
