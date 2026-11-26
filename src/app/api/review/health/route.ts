import { checkOrigin, requireAdmin } from '@/server/auth';
import { setSetting } from '@/server/db';
import { getDecisionModel, unusableReason } from '@/server/decision/models';
import { failure, json } from '@/server/http';
import { checkConnection, ensureWorker, healthStatus } from '@/server/review/runner';
import { AppError } from '@/server/validation';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try { requireAdmin(request); ensureWorker(); return json(healthStatus()); }
  catch (error) { return failure(error); }
}

/** Updates the active review decision model or total review timeout (failover order is only editable in Models & Channels). */
export async function PUT(request: Request) {
  try {
    requireAdmin(request);
    checkOrigin(request);
    const body = await request.json() as {model_id?:unknown;total_timeout_ms?:unknown};
    if (body.model_id !== undefined) {
      const modelId = typeof body.model_id==='string' ? body.model_id.trim() : '';
      const model = getDecisionModel(modelId);
      if (!model) throw new AppError('INVALID_INPUT',400,'判定模型不存在');
      const reason = unusableReason(model);
      if (reason) throw new AppError('INVALID_INPUT',400,`判定模型不可用：${reason}`);
      setSetting('decision_review_model_id',modelId);
    }
    if (body.total_timeout_ms !== undefined) {
      const totalMs = Number(body.total_timeout_ms);
      if (!Number.isInteger(totalMs) || totalMs < 2000 || totalMs > 120000) {
        throw new AppError('INVALID_INPUT',400,'总超时时间需为 2000～120000 ms');
      }
      setSetting('review_total_timeout_ms',String(totalMs));
    }
    return json(healthStatus());
  } catch (error) { return failure(error); }
}

/** Minimal live call to verify the Decisions connection; never returns the key. */
export async function POST(request: Request) {
  try {
    requireAdmin(request);
    checkOrigin(request);
    let modelId: string|null = null;
    try {
      const body = await request.json() as {model_id?:unknown};
      if (typeof body?.model_id==='string' && body.model_id.trim()) modelId = body.model_id.trim();
    } catch { /* empty body ok */ }
    return json({...await checkConnection(modelId),health:healthStatus()});
  }
  catch (error) { return failure(error); }
}
