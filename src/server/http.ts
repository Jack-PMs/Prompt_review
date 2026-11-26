import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { AppError } from './validation';

export async function readJson(request: Request, maxBytes = 16_384): Promise<unknown> {
  const length = request.headers.get('content-length');
  if (length && Number(length) > maxBytes) throw new AppError('PAYLOAD_TOO_LARGE',413,'请求内容过大');
  const reader = request.body?.getReader();
  if (!reader) throw new AppError('INVALID_JSON',400,'缺少 JSON 请求体');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new AppError('PAYLOAD_TOO_LARGE',413,'请求内容过大'); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  try {
    const joined = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { joined.set(chunk,offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(joined));
  } catch { throw new AppError('INVALID_JSON',400,'请求体不是有效 JSON'); }
}

export const corsHeaders = {
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Methods':'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':'Content-Type, Authorization, Idempotency-Key',
};

export function json(data: unknown, status = 200, id = randomUUID()) {
  return NextResponse.json(data,{status,headers:{'X-Request-Id':id,'Cache-Control':'private, no-store',...corsHeaders}});
}

export function failure(error: unknown) {
  const id = randomUUID();
  if (error instanceof AppError) return json({error:{code:error.code,message:error.message,request_id:id}},error.status,id);
  console.error('[api]',{requestId:id,errorCode:'INTERNAL_ERROR'});
  return json({error:{code:'INTERNAL_ERROR',message:'服务暂时不可用',request_id:id}},500,id);
}
