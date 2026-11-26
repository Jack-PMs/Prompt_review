import { checkOrigin, requireAdmin } from '@/server/auth';
import { demoEnhance } from '@/server/demo';
import { failure, json, readJson } from '@/server/http';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    requireAdmin(request); checkOrigin(request);
    const input = await readJson(request,16_384);
    return json({demo:true,...await demoEnhance(input)});
  } catch (error) { return failure(error); }
}
