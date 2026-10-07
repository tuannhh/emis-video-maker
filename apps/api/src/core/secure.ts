import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { config } from './config.js';

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number, opts: crypto.ScryptOptions) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/** Băm mật khẩu: "scrypt$<salt>$<hash>" (base64url) */
export async function hashPassword(password: string) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 32, SCRYPT);
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [algo, salt, hash] = stored.split('$');
  if (algo !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const actual = await scrypt(password, Buffer.from(salt, 'base64url'), expected.length, SCRYPT);
  return crypto.timingSafeEqual(actual, expected);
}

/** Khoá con theo mục đích, để một bí mật dùng được cho nhiều việc mà không lẫn chữ ký */
function subkey(purpose: string) {
  return crypto.createHmac('sha256', config.appSecret).update(purpose).digest();
}

export function sign(purpose: string, value: string) {
  return crypto.createHmac('sha256', subkey(purpose)).update(value).digest('base64url');
}

export function verifySignature(purpose: string, value: string, signature: string) {
  const expected = Buffer.from(sign(purpose, value));
  const actual = Buffer.from(signature);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

/** Mã hoá AES-256-GCM: "v1.<iv>.<tag>.<data>" */
export function encrypt(plain: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', subkey('settings-encryption'), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv, cipher.getAuthTag(), data].map((p) => (typeof p === 'string' ? p : p.toString('base64url'))).join('.');
}

export function decrypt(sealed: string) {
  const [v, iv, tag, data] = sealed.split('.');
  if (v !== 'v1') throw new Error('Định dạng mã hoá không hỗ trợ');
  const decipher = crypto.createDecipheriv('aes-256-gcm', subkey('settings-encryption'), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}
