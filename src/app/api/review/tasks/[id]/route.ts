import { checkOrigin, requireAdmin } from '@/server/auth';
import { failure, json, readJson } from '@/server/http';
import { getAsset } from '@/server/review/assets';
import { ensureWorker } from '@/server/review/runner';
import { getTask, overrideTaskAction, taskApiCalls, taskSignals, taskView, type TaskRow } from '@/server/review/store';
import { AppError } from '@/server/validation';

export const runtime = 'nodejs';

function buildTaskDetail(task: TaskRow) {
  const view = taskView(task);
  return {
    ...view,
    signals: taskSignals(task.id),
    api_calls: taskApiCalls(task.id),
    assets: view.asset_ids.map(assetId => {
      const a = getAsset(assetId);
      return a
        ? { id: a.id, sha256: a.sha256, mime: a.mime, bytes: a.bytes, width: a.width, height: a.height }
        : { id: assetId, missing: true };
    }),
  };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireAdmin(request);
    ensureWorker();
    const { id } = await params;
    const task = getTask(id);
    if (!task) throw new AppError('NOT_FOUND', 404, '审核任务不存在');
    return json(buildTaskDetail(task));
  } catch (error) {
    return failure(error);
  }
}

/**
 * PATCH /api/review/tasks/[id]
 * 管理员手动改判审核任务（主要用于对机器拦截的结果进行手动放行，或将误放行内容改判为拦截）。
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireAdmin(request);
    checkOrigin(request);
    const { id } = await params;
    const body = await readJson(request, 8192) as {
      action?: unknown;
      note?: unknown;
      revision?: unknown;
    };
    const action = body?.action;
    if (action !== 'ALLOW' && action !== 'BLOCK') {
      throw new AppError('INVALID_INPUT', 400, 'action 必须为 ALLOW（放行）或 BLOCK（拦截）');
    }
    const note = typeof body?.note === 'string' ? body.note.trim() : '';
    if (note.length > 200) {
      throw new AppError('INVALID_INPUT', 400, '备注最多 200 字');
    }
    const expectedRevision = typeof body?.revision === 'number' && Number.isInteger(body.revision)
      ? body.revision
      : undefined;

    const updated = overrideTaskAction({
      id,
      action,
      note,
      actor: 'admin',
      expectedRevision,
    });
    return json(buildTaskDetail(updated));
  } catch (error) {
    return failure(error);
  }
}
