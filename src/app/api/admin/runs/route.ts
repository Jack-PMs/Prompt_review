import { requireAdmin } from '@/server/auth';
import { db, getActivePrompt } from '@/server/db';
import { failure, json } from '@/server/http';
import { benchmarkStats } from '@/server/stats';
import type { RunRecord } from '@/server/types';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    requireAdmin(request);
    const url = new URL(request.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit'))||50,1),200);
    const modelId = url.searchParams.get('model_id');
    const runs = (modelId
      ? db().prepare('SELECT * FROM runs WHERE model_id=? ORDER BY created_at DESC LIMIT ?').all(modelId,limit)
      : db().prepare('SELECT * FROM runs ORDER BY created_at DESC LIMIT ?').all(limit)) as RunRecord[];
    return json({runs,stats:benchmarkStats(),active_version:getActivePrompt().version});
  } catch (error) { return failure(error); }
}
