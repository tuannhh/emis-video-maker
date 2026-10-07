import crypto from 'node:crypto';

/** Gọi Google API bằng service account của Cloud Run (lấy token qua metadata server, không cần file key) */
const METADATA = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default';

let token: { value: string; expires: number } | null = null;
let email: string | null = null;

async function metadata(path: string) {
  const res = await fetch(`${METADATA}/${path}`, { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Metadata server ${res.status}`);
  return res;
}

export async function accessToken() {
  if (token && token.expires - Date.now() > 60_000) return token.value;
  const body = (await (await metadata('token')).json()) as { access_token: string; expires_in: number };
  token = { value: body.access_token, expires: Date.now() + body.expires_in * 1000 };
  return token.value;
}

export async function serviceAccountEmail() {
  email ??= (await (await metadata('email')).text()).trim();
  return email;
}

export async function googleApi<T = any>(url: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(url, {
    method: init.method ?? 'GET',
    headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

/** Mã hoá theo RFC 3986 (encodeURIComponent bỏ sót !'()*) */
function rfc3986(s: string) {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * Link tải GCS ký V4 (ký bằng IAM signBlob của chính service account, cần quyền Service Account Token Creator
 * trên chính nó). Trình duyệt tải thẳng từ GCS nên không vướng giới hạn kích thước phản hồi của Cloud Run.
 */
export async function signedGcsUrl(bucket: string, object: string, expiresSec: number, disposition?: string) {
  const sa = await serviceAccountEmail();
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const day = stamp.slice(0, 8);
  const scope = `${day}/auto/storage/goog4_request`;
  const host = 'storage.googleapis.com';
  const path = `/${bucket}/${object.split('/').map(rfc3986).join('/')}`;
  const params: Record<string, string> = {
    'X-Goog-Algorithm': 'GOOG4-RSA-SHA256',
    'X-Goog-Credential': `${sa}/${scope}`,
    'X-Goog-Date': stamp,
    'X-Goog-Expires': String(expiresSec),
    'X-Goog-SignedHeaders': 'host',
  };
  if (disposition) params['response-content-disposition'] = disposition;
  const query = Object.keys(params)
    .sort()
    .map((k) => `${rfc3986(k)}=${rfc3986(params[k])}`)
    .join('&');
  const canonical = ['GET', path, query, `host:${host}`, '', 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const toSign = ['GOOG4-RSA-SHA256', stamp, scope, crypto.createHash('sha256').update(canonical).digest('hex')].join('\n');
  const { signedBlob } = await googleApi<{ signedBlob: string }>(
    `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(sa)}:signBlob`,
    { method: 'POST', body: { payload: Buffer.from(toSign).toString('base64') } },
  );
  const signature = Buffer.from(signedBlob, 'base64').toString('hex');
  return `https://${host}${path}?${query}&X-Goog-Signature=${signature}`;
}
