import { checkOrigin, requireAdmin } from '@/server/auth';
import { audit, db, getScene } from '@/server/db';
import { failure, json, readJson } from '@/server/http';
import { validateSceneFields } from '@/server/scenes';
import { AppError } from '@/server/validation';

export const runtime = 'nodejs';

export async function PATCH(request: Request, {params}:{params:Promise<{id:string}>}) {
  try {
    requireAdmin(request); checkOrigin(request);
    const {id} = await params;
    const current = getScene(id);
    if (!current) throw new AppError('NOT_FOUND',404,'场景不存在');
    const body = await readJson(request,4096) as Record<string,unknown>;
    if (!body || typeof body !== 'object' || body.updated_at !== current.updated_at) throw new AppError('CONFIG_CONFLICT',409,'场景配置已更新，请刷新');
    const fields = validateSceneFields(body,current);
    const result = db().prepare('UPDATE scenes SET name=?,rules=?,fallback_scene=?,enabled=?,updated_at=? WHERE id=? AND updated_at=?')
      .run(fields.name,fields.rules,fields.fallback_scene,fields.enabled,new Date().toISOString(),id,current.updated_at);
    if (!result.changes) throw new AppError('CONFIG_CONFLICT',409,'场景配置已更新，请刷新');
    audit('admin','update','scene:'+id,JSON.stringify(fields));
    return json({saved:true,scene:getScene(id)});
  } catch (error) { return failure(error); }
}
