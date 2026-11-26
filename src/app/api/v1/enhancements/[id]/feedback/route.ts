import { requireApiKey } from '@/server/auth';
import { db } from '@/server/db';
import { failure, json, readJson } from '@/server/http';
import { AppError } from '@/server/validation';

export const runtime = 'nodejs';

export async function POST(request: Request,{params}:{params:Promise<{id:string}>}) {
  try {
    requireApiKey(request);
    const {id} = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError('INVALID_INPUT',400,'请求 ID 格式错误');
    const body = await readJson(request,1024) as Record<string,unknown>;
    if (!body || typeof body !== 'object' || !['accepted','edited','rejected'].includes(String(body.action))) throw new AppError('INVALID_INPUT',400,'反馈类型无效');
    const run = db().prepare("SELECT id FROM runs WHERE id=? AND kind='live' AND status='success'").get(id);
    if (!run) throw new AppError('NOT_FOUND',404,'强化请求不存在');
    db().prepare('INSERT INTO feedback(run_id,action,created_at) VALUES (?,?,?) ON CONFLICT(run_id) DO UPDATE SET action=excluded.action,created_at=excluded.created_at')
      .run(id,body.action,new Date().toISOString());
    return json({saved:true});
  } catch (error) { return failure(error); }
}
