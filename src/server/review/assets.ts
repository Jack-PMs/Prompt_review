import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { AppError } from '../validation';
import { reviewDb } from './store';

const MAX_BYTES = (Number(process.env.REVIEW_MAX_UPLOAD_MB) || 10) * 1024 * 1024;
const MAX_PIXELS = Number(process.env.REVIEW_MAX_IMAGE_PIXELS) || 25_000_000;

/** Private directory under DATA_DIR; never served statically. Files are read only through checked routes. */
function mediaDir() {
  const dir = path.resolve(/* turbopackIgnore: true */ process.env.DATA_DIR || './data','private_media');
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  return dir;
}

export const sha256 = (data: Buffer|string) => createHash('sha256').update(data).digest('hex');

/** Detects the real format from file bytes (not the declared MIME) and reads dimensions from the header. */
export function sniffImage(buf: Buffer): {mime:string;ext:string;width:number;height:number}|null {
  if (buf.length>24 && buf.readUInt32BE(0)===0x89504e47) return {mime:'image/png',ext:'png',width:buf.readUInt32BE(16),height:buf.readUInt32BE(20)};
  if (buf.length>10 && buf.subarray(0,6).toString('ascii').startsWith('GIF8')) return {mime:'image/gif',ext:'gif',width:buf.readUInt16LE(6),height:buf.readUInt16LE(8)};
  if (buf.length>30 && buf.subarray(0,4).toString('ascii')==='RIFF' && buf.subarray(8,12).toString('ascii')==='WEBP') {
    const chunk = buf.subarray(12,16).toString('ascii');
    if (chunk==='VP8X') return {mime:'image/webp',ext:'webp',width:1+buf.readUIntLE(24,3),height:1+buf.readUIntLE(27,3)};
    if (chunk==='VP8L') { const b=buf.readUInt32LE(21); return {mime:'image/webp',ext:'webp',width:1+(b&0x3fff),height:1+((b>>14)&0x3fff)}; }
    if (chunk==='VP8 ') return {mime:'image/webp',ext:'webp',width:buf.readUInt16LE(26)&0x3fff,height:buf.readUInt16LE(28)&0x3fff};
    return null;
  }
  if (buf.length>4 && buf[0]===0xff && buf[1]===0xd8) {
    let offset = 2;
    while (offset+9<buf.length) {
      if (buf[offset]!==0xff) { offset++; continue; }
      const marker = buf[offset+1];
      if (marker>=0xc0 && marker<=0xcf && ![0xc4,0xc8,0xcc].includes(marker)) {
        return {mime:'image/jpeg',ext:'jpg',height:buf.readUInt16BE(offset+5),width:buf.readUInt16BE(offset+7)};
      }
      offset += 2+buf.readUInt16BE(offset+2);
    }
    return null;
  }
  return null;
}

export interface StoredAsset { id:string; sha256:string; mime:string; bytes:number; width:number; height:number }

/** Decodes a base64 data URL, validates it as a real image within limits, and stores it privately (deduplicated by hash). */
export function storeImage(dataUrl: string, index: number): StoredAsset {
  const match = /^data:image\/[a-z+]+;base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) throw new AppError('INVALID_INPUT',400,`第 ${index+1} 张图片格式无效，需为 base64 图片`);
  const buf = Buffer.from(match[1],'base64');
  if (buf.length>MAX_BYTES) throw new AppError('INVALID_INPUT',400,`第 ${index+1} 张图片超过 ${MAX_BYTES/1024/1024} MB`);
  const info = sniffImage(buf);
  if (!info || !info.width || !info.height) throw new AppError('INVALID_INPUT',400,`第 ${index+1} 张图片无法识别，仅支持 PNG、JPEG、WebP、GIF`);
  if (info.width*info.height>MAX_PIXELS) throw new AppError('INVALID_INPUT',400,`第 ${index+1} 张图片像素过大（${info.width}×${info.height}）`);
  const hash = sha256(buf);
  const id = `ast_${hash.slice(0,24)}`;
  const existing = reviewDb().prepare('SELECT id,sha256,mime,bytes,width,height FROM review_assets WHERE id=?').get(id) as StoredAsset|undefined;
  if (existing && fs.existsSync(assetPath(id)!)) return existing;
  const file = path.join(/* turbopackIgnore: true */ mediaDir(),`${hash}.${info.ext}`);
  fs.writeFileSync(file,buf,{mode:0o600});
  reviewDb().prepare('INSERT OR REPLACE INTO review_assets(id,sha256,mime,bytes,width,height,path,created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(id,hash,info.mime,buf.length,info.width,info.height,path.basename(file),new Date().toISOString());
  return {id,sha256:hash,mime:info.mime,bytes:buf.length,width:info.width,height:info.height};
}

export function getAsset(id: string): (StoredAsset & {path:string})|undefined {
  return reviewDb().prepare('SELECT id,sha256,mime,bytes,width,height,path FROM review_assets WHERE id=?').get(id) as (StoredAsset & {path:string})|undefined;
}
export function assetPath(id: string): string|null {
  const row = reviewDb().prepare('SELECT path FROM review_assets WHERE id=?').get(id) as {path:string}|undefined;
  return row ? path.join(/* turbopackIgnore: true */ mediaDir(),path.basename(row.path)) : null;
}
/** Reads the file and re-verifies its hash; null when missing or altered (a technical gate, never manually waivable). */
export function readVerifiedAsset(id: string): {buf:Buffer;mime:string}|null {
  const asset = getAsset(id);
  const file = assetPath(id);
  if (!asset || !file || !fs.existsSync(file)) return null;
  const buf = fs.readFileSync(file);
  return sha256(buf)===asset.sha256 ? {buf,mime:asset.mime} : null;
}
