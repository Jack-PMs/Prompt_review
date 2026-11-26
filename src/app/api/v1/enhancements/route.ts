import { requireApiKey } from '@/server/auth';
import { enhance } from '@/server/enhance';
import { failure, json, readJson } from '@/server/http';
import { IMAGE_BODY_LIMIT } from '@/server/validation';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    requireApiKey(request);
    const body = await readJson(request,IMAGE_BODY_LIMIT);
    return json(await enhance(body,{kind:'live'}));
  } catch (error) { return failure(error); }
}
