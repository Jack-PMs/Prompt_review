import { checkOrigin, requireAdmin } from '@/server/auth';
import { testDecisionModel } from '@/server/decision/admin';
import { failure, json } from '@/server/http';

export const runtime = 'nodejs';

/** Minimal live calls to check a decision model works (text yes/no + choice, and images if the channel supports them). */
export async function POST(request: Request,{params}:{params:Promise<{id:string}>}) {
  try { requireAdmin(request); checkOrigin(request); const {id} = await params; return json(await testDecisionModel(id)); }
  catch (error) { return failure(error); }
}
