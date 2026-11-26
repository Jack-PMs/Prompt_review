import { checkOrigin, requireAdmin } from '@/server/auth';
import { enhance } from '@/server/enhance';
import { failure, json, readJson } from '@/server/http';
import { AppError, IMAGE_BODY_LIMIT } from '@/server/validation';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    requireAdmin(request); checkOrigin(request);
    const body = await readJson(request,IMAGE_BODY_LIMIT) as Record<string,unknown>;
    if (!body || typeof body !== 'object' || typeof body.model_id !== 'string' || !Number.isInteger(body.prompt_version)) throw new AppError('INVALID_INPUT',400,'测试参数无效');
    return json(await enhance({text:body.text,context:body.context},{kind:body.kind==='benchmark'?'benchmark':'playground',modelId:body.model_id,promptVersion:Number(body.prompt_version)}));
  } catch (error) { return failure(error); }
}
