import { requireAdmin } from '@/server/auth';
import { db } from '@/server/db';
import { failure, json } from '@/server/http';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    requireAdmin(request);
    const records = db().prepare('SELECT id,actor,action,subject,detail,created_at FROM audit ORDER BY id DESC LIMIT 100').all();
    return json({records});
  } catch (error) { return failure(error); }
}
