import { NextResponse } from 'next/server';
import { requireAdmin } from '@/server/auth';
import { audit } from '@/server/db';
import { failure } from '@/server/http';
import { readVerifiedAsset } from '@/server/review/assets';
import { AppError } from '@/server/validation';

export const runtime = 'nodejs';

/** Reviewer-only evidence access to a private asset; the hash is re-verified on every read and access is audited. */
export async function GET(request: Request,{params}:{params:Promise<{id:string}>}) {
  try {
    requireAdmin(request);
    const {id} = await params;
    if (!/^ast_[0-9a-f]{24}$/.test(id)) throw new AppError('INVALID_INPUT',400,'素材 ID 无效');
    const file = readVerifiedAsset(id);
    if (!file) throw new AppError('ASSET_UNAVAILABLE',404,'素材缺失或已被修改');
    if (new URL(request.url).searchParams.get('purpose')==='evidence') audit('admin','view_evidence','review_asset:'+id,'');
    return new NextResponse(new Uint8Array(file.buf),{headers:{'content-type':file.mime,'cache-control':'private, no-store','x-content-type-options':'nosniff'}});
  } catch (error) { return failure(error); }
}
