/**
 * Chuẩn hóa văn bản tiếng Việt trước khi đưa vào TTS:
 * đọc số thành chữ và ký hiệu toán học thành lời.
 */

const DIGITS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];

function readTriple(n: number, full: boolean): string {
  const hundreds = Math.floor(n / 100);
  const tens = Math.floor((n % 100) / 10);
  const ones = n % 10;
  const parts: string[] = [];

  if (full || hundreds > 0) parts.push(`${DIGITS[hundreds]} trăm`);

  if (tens === 0) {
    if (ones > 0 && (full || hundreds > 0)) parts.push('linh');
  } else if (tens === 1) {
    parts.push('mười');
  } else {
    parts.push(`${DIGITS[tens]} mươi`);
  }

  if (ones > 0) {
    if (ones === 1 && tens > 1) parts.push('mốt');
    else if (ones === 5 && tens > 0) parts.push('lăm');
    else if (ones === 4 && tens > 1) parts.push('tư');
    else parts.push(DIGITS[ones]);
  }
  return parts.join(' ');
}

export function readNumberVi(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (value < 0) return `âm ${readNumberVi(-value)}`;
  if (!Number.isInteger(value)) {
    const [int, frac] = String(value).split('.');
    return `${readNumberVi(Number(int))} phẩy ${frac.split('').map((d) => DIGITS[Number(d)]).join(' ')}`;
  }
  if (value < 10) return DIGITS[value];

  const units = ['', 'nghìn', 'triệu', 'tỷ'];
  const groups: number[] = [];
  let n = value;
  while (n > 0) {
    groups.push(n % 1000);
    n = Math.floor(n / 1000);
  }
  const words: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i];
    if (g === 0) continue;
    const isHighest = i === groups.length - 1;
    words.push(readTriple(g, !isHighest));
    if (units[i]) words.push(units[i]);
  }
  return words.join(' ').replace(/\s+/g, ' ').trim();
}

const SYMBOLS: [RegExp, string][] = [
  [/\s*\+\s*/g, ' cộng '],
  [/\s+-\s+/g, ' trừ '],
  [/\s*[x×]\s*(?=\d)/g, ' nhân '],
  [/\s*[:÷]\s*(?=\d)/g, ' chia '],
  [/\s*=\s*/g, ' bằng '],
  [/\s*>=\s*/g, ' lớn hơn hoặc bằng '],
  [/\s*<=\s*/g, ' bé hơn hoặc bằng '],
  [/\s*>\s*/g, ' lớn hơn '],
  [/\s*<\s*/g, ' bé hơn '],
  [/%/g, ' phần trăm'],
];

export function normalizeForTts(text: string): string {
  let out = text;
  for (const [re, word] of SYMBOLS) out = out.replace(re, word);
  out = out.replace(/\d+(?:[.,]\d+)?/g, (m) => readNumberVi(Number(m.replace(',', '.'))));
  return out.replace(/\s+/g, ' ').trim();
}
