import { checkOrigin, requireAdmin } from '@/server/auth';
import { audit, db, getScene, listScenes } from '@/server/db';
import { failure, json, readJson } from '@/server/http';
import { validateSceneFields } from '@/server/scenes';
import { AppError, SCENE_ID_PATTERN } from '@/server/validation';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    requireAdmin(request);
    return json({scenes:listScenes()});
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    requireAdmin(request); checkOrigin(request);
    const body = await readJson(request,4096) as Record<string,unknown>;
    if (!body || typeof body !== 'object') throw new AppError('INVALID_INPUT',400,'场景格式无效');
    const id = typeof body.id === 'string' ? body.id.trim() : '';
    if (!SCENE_ID_PATTERN.test(id)) throw new AppError('INVALID_INPUT',400,'场景标识只能用小写字母、数字和连字符，最多 40 字符');
    if (getScene(id)) throw new AppError('CONFIG_CONFLICT',409,`场景 ${id} 已存在`);
    const fields = validateSceneFields(body);
    db().prepare('INSERT INTO scenes(id,name,rules,fallback_scene,enabled,updated_at) VALUES (?,?,?,?,?,?)')
      .run(id,fields.name,fields.rules,fields.fallback_scene,fields.enabled,new Date().toISOString());
    audit('admin','create','scene:'+id,JSON.stringify(fields));
    return json({saved:true,scene:getScene(id)});
  } catch (error) { return failure(error); }
}
