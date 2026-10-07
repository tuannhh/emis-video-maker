import zlib from 'node:zlib';

/**
 * Đọc file Word (.docx = file zip chứa XML) không cần thư viện ngoài: lấy chữ theo đoạn/bảng và các ảnh nhúng
 * (để AI đọc chữ trong ảnh). File .doc cũ (nhị phân) không hỗ trợ.
 */
export interface DocxContent {
  text: string;
  images: { name: string; mime: string; data: Buffer }[];
}

function unzip(buf: Buffer): Map<string, Buffer> {
  // Tìm bản ghi cuối thư mục trung tâm (End Of Central Directory) từ cuối file
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Không phải file .docx hợp lệ');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map<string, Buffer>();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('File .docx bị hỏng');
    const method = buf.readUInt16LE(p + 10);
    const compressed = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + compressed);
    if (method === 0) files.set(name, raw);
    else if (method === 8) files.set(name, zlib.inflateRawSync(raw, { maxOutputLength: 50 * 1024 * 1024 }));
  }
  return files;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function xmlText(xml: string) {
  return xml
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br[^>]*\/>/g, '\n')
    .replace(/<\/w:tc>/g, ' | ')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) => {
      if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
      return ENTITIES[e] ?? m;
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function readDocx(buf: Buffer): DocxContent {
  const files = unzip(buf);
  const doc = files.get('word/document.xml');
  if (!doc) throw new Error('Không đọc được nội dung file Word');
  const text = xmlText(doc.toString('utf8'));
  const images: DocxContent['images'] = [];
  for (const [name, data] of files) {
    const m = /^word\/media\/.+\.(png|jpe?g)$/i.exec(name);
    if (m) images.push({ name, mime: m[1].toLowerCase() === 'png' ? 'image/png' : 'image/jpeg', data });
  }
  return { text, images };
}
