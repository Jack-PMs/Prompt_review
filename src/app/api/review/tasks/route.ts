import { checkOrigin, requireAdmin } from '@/server/auth';
import { corsHeaders, failure, json, readJson } from '@/server/http';
import { createTask, ensureWorker, waitForTask } from '@/server/review/runner';
import { reviewDb, taskView, type TaskRow } from '@/server/review/store';
import { IMAGE_BODY_LIMIT } from '@/server/validation';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return new Response(null,{status:204,headers:corsHeaders});
}

export async function GET(request: Request) {
  try {
    requireAdmin(request); ensureWorker();
    const url = new URL(request.url);
    const where: string[] = []; const args: unknown[] = [];
    const action = url.searchParams.get('action');
    const status = url.searchParams.get('status');
    const violationLevel = url.searchParams.get('violation_level');
    if (action && ['ALLOW','BLOCK'].includes(action)) { where.push('action=?'); args.push(action); }
    if (violationLevel && ['NONE','POSSIBLE','ABSOLUTE'].includes(violationLevel)) { where.push('violation_level=?'); args.push(violationLevel); }
    if (status && ['PENDING','RUNNING','COMPLETE','FAILED'].includes(status)) { where.push('execution_status=?'); args.push(status); }
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit'))||100,1),300);
    const rows = reviewDb().prepare(`SELECT * FROM review_tasks ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY created_at DESC LIMIT ?`).all(...args,limit) as TaskRow[];
    return json({tasks:rows.map(taskView)});
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    requireAdmin(request); checkOrigin(request); ensureWorker();
    const url = new URL(request.url);
    const body = await readJson(request,IMAGE_BODY_LIMIT);
    const created = createTask(body,request.headers.get('idempotency-key'));
    if (url.searchParams.get('wait')==='1') {
      const row = await waitForTask(created.task_id);
      if (row) return json({...created,...taskView(row)},200);
    }
    return json(created,created.reused?200:202);
  } catch (error) { return failure(error); }
}
