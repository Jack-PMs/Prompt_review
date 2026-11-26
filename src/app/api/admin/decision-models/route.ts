import { checkOrigin, requireAdmin } from '@/server/auth';
import { audit } from '@/server/db';
import { decisionOverview } from '@/server/decision/admin';
import { DECISION_CHANNELS, decisionDb, getDecisionModel, listDecisionModels, reorderDecisionModels, type DecisionChannelId } from '@/server/decision/models';
import { failure, json, readJson } from '@/server/http';
import { AppError } from '@/server/validation';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try { requireAdmin(request); return json(decisionOverview()); }
  catch (error) { return failure(error); }
}

/** Reorders all decision models in the failover chain. */
export async function PUT(request: Request) {
  try {
    requireAdmin(request); checkOrigin(request);
    const body = await readJson(request,4096) as {ordered_ids?:unknown};
    if (!Array.isArray(body?.ordered_ids) || body.ordered_ids.some(id=>typeof id!=='string')) {
      throw new AppError('INVALID_INPUT',400,'排序列表格式无效');
    }
    reorderDecisionModels(body.ordered_ids as string[]);
    audit('admin','update','decision_models_order',JSON.stringify(body.ordered_ids));
    return json(decisionOverview());
  } catch (error) { return failure(error); }
}

/** Registers a decision model on one of the preset channels (keys stay in the environment). */
export async function POST(request: Request) {
  try {
    requireAdmin(request); checkOrigin(request);
    const body = await readJson(request,4096) as Record<string,unknown>;
    const channel = String(body.channel||'') as DecisionChannelId;
    if (!(channel in DECISION_CHANNELS)) throw new AppError('INVALID_INPUT',400,'渠道无效');
    const model = typeof body.model==='string' ? body.model.trim() : '';
    if (!/^[a-zA-Z0-9._:/-]{2,100}$/.test(model)) throw new AppError('INVALID_INPUT',400,'模型 ID 只能包含字母、数字和 . _ : / -');
    const workspace = typeof body.workspace_id==='string' ? body.workspace_id.trim() : '';
    if (workspace && !/^[a-z0-9-]{3,64}$/i.test(workspace)) throw new AppError('INVALID_INPUT',400,'工作空间 ID 格式无效');
    const id = `${channel}-${model}`.toLowerCase().replace(/[^a-z0-9-]+/g,'-').slice(0,60);
    if (getDecisionModel(id)) throw new AppError('CONFIG_CONFLICT',409,'该渠道下已登记这个模型');
    const nextPriority = listDecisionModels().length + 1;
    decisionDb().prepare('INSERT INTO decision_models(id,channel,model,workspace_id,enabled,timeout_ms,priority,updated_at) VALUES (?,?,?,?,0,6000,?,?)')
      .run(id,channel,model,workspace,nextPriority,new Date().toISOString());
    audit('admin','create','decision_model:'+id,`${channel} ${model}`);
    return json({saved:true,id},201);
  } catch (error) { return failure(error); }
}
