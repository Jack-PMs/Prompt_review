import { checkOrigin, requireAdmin } from '@/server/auth';
import { audit, db, getModel } from '@/server/db';
import { failure, json, readJson } from '@/server/http';
import { AppError } from '@/server/validation';

export const runtime = 'nodejs';

export async function PATCH(request: Request, {params}:{params:Promise<{id:string}>}) {
  try {
    requireAdmin(request); checkOrigin(request);
    const {id} = await params;
    const current = getModel(id);
    if (!current) throw new AppError('NOT_FOUND',404,'模型不存在');
    const body = await readJson(request,2048) as Record<string,unknown>;
    if (!body || typeof body !== 'object' || body.updated_at !== current.updated_at) throw new AppError('CONFIG_CONFLICT',409,'模型配置已更新，请刷新');
    const model = typeof body.model === 'string' ? body.model.trim() : current.model;
    const enabled = typeof body.enabled === 'boolean' ? Number(body.enabled) : current.enabled;
    const timeout = Number(body.timeout_ms ?? current.timeout_ms);
    const maxTokens = Number(body.max_output_tokens ?? current.max_output_tokens);
    if (!/^[a-zA-Z0-9._:/-]{2,100}$/.test(model) || !Number.isInteger(timeout) || timeout<3000 || timeout>60000 || !Number.isInteger(maxTokens) || maxTokens<200 || maxTokens>4000) {
      throw new AppError('INVALID_INPUT',400,'模型参数不合法');
    }
    const updated = new Date().toISOString();
    const result = db().prepare('UPDATE models SET model=?,enabled=?,timeout_ms=?,max_output_tokens=?,updated_at=? WHERE id=? AND updated_at=?')
      .run(model,enabled,timeout,maxTokens,updated,id,current.updated_at);
    if (!result.changes) throw new AppError('CONFIG_CONFLICT',409,'模型配置已更新，请刷新');
    audit('admin','update','model:'+id,JSON.stringify({model,enabled,timeout,maxTokens}));
    return json({saved:true,model:getModel(id)});
  } catch (error) { return failure(error); }
}
