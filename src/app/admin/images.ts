'use client';

export type RefImage = {src:string;label:string};
/** Downscale uploads to at most 1600px and re-encode as JPEG so requests stay small. */
export async function fileToImage(file: File): Promise<RefImage> {
  if (file.size > 20*1024*1024) throw new Error(`${file.name} 超过 20 MB`);
  const bitmap = await createImageBitmap(file).catch(()=>{ throw new Error(`${file.name} 无法读取，请换一张 PNG、JPEG 或 WebP 图片`); });
  const scale = Math.min(1,1600/Math.max(bitmap.width,bitmap.height));
  const width = Math.round(bitmap.width*scale), height = Math.round(bitmap.height*scale);
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('浏览器无法处理图片');
  ctx.fillStyle = '#fff'; ctx.fillRect(0,0,width,height); ctx.drawImage(bitmap,0,0,width,height);
  return {src:canvas.toDataURL('image/jpeg',0.88),label:`${file.name} · ${width}×${height}`};
}
