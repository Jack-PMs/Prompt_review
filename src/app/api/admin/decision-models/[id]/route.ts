import { checkOrigin, requireAdmin } from '@/server/auth';
import { audit } from '@/server/db';
import { decisionDb, getDecisionModel } from '@/server/decision/models';
import { failure, json, readJson } from '@/server/http';
import { AppError } from '@/server/validation';

export const runtime = 'nodejs';

export async function PATCH(request: Request,{params}:{params:Promise<{id:string}>}) {
  try {
    requireAdmin(request); checkOrigin(request);
    const {id} = await params;
    const current = getDecisionModel(id);
    if (!current) throw new AppError('NOT_FOUND',404,'判定模型不存在');
    const body = await readJson(request,4096) as Record<string,unknown>;
    if (body.updated_at!==current.updated_at) throw new AppError('CONFIG_CONFLICT',409,'配置已更新，请刷新');
    const model = typeof body.model==='string' ? body.model.trim() : current.model;
    const workspace = typeof body.workspace_id==='string' ? body.workspace_id.trim() : current.workspace_id;
    const enabled = typeof body.enabled==='boolean' ? Number(body.enabled) : current.enabled;
    const timeout = Number(body.timeout_ms ?? current.timeout_ms);
    if (!/^[a-zA-Z0-9._:/-]{2,100}$/.test(model)) throw new AppError('INVALID_INPUT',400,'模型 ID 格式无效');
    if (workspace && !/^[a-z0-9-]{3,64}$/i.test(workspace)) throw new AppError('INVALID_INPUT',400,'工作空间 ID 格式无效');
    if (!Number.isInteger(timeout) || timeout<2000 || timeout>60000) throw new AppError('INVALID_INPUT',400,'超时需为 2000～60000 ms');
    const changed = model!==current.model || workspace!==current.workspace_id;
    const result = decisionDb().prepare('UPDATE decision_models SET model=?,workspace_id=?,enabled=?,timeout_ms=?,last_test=?,updated_at=? WHERE id=? AND updated_at=?')
      .run(model,workspace,enabled,timeout,changed?null:current.last_test,new Date().toISOString(),id,current.updated_at);
    if (!result.changes) throw new AppError('CONFIG_CONFLICT',409,'配置已更新，请刷新');
    audit('admin','update','decision_model:'+id,JSON.stringify({model,workspace,enabled,timeout}));
    return json({saved:true});
  } catch (error) { return failure(error); }
}
