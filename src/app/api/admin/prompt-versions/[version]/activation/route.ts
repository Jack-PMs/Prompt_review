import { checkOrigin, requireAdmin } from '@/server/auth';
import { audit, db, getActivePrompt, setSetting } from '@/server/db';
import { failure, json, readJson } from '@/server/http';
import { AppError } from '@/server/validation';

export const runtime = 'nodejs';

export async function POST(request: Request,{params}:{params:Promise<{version:string}>}) {
  try {
    requireAdmin(request); checkOrigin(request);
    const body = await readJson(request,1024) as Record<string,unknown>;
    const {version:raw} = await params;
    const version = Number(raw);
    if (!Number.isInteger(version) || version<1 || !body || typeof body !== 'object' || !Number.isInteger(body.expected_active_version)) throw new AppError('INVALID_INPUT',400,'版本参数无效');
    db().transaction(() => {
      if (getActivePrompt().version !== body.expected_active_version) throw new AppError('CONFIG_CONFLICT',409,'生效版本已变化，请刷新');
      const exists = db().prepare('SELECT 1 FROM prompt_versions WHERE version=?').get(version);
      if (!exists) throw new AppError('NOT_FOUND',404,'提示词版本不存在');
      setSetting('active_prompt_version',String(version));
      audit('admin','activate','prompt:'+String(version),`from ${body.expected_active_version}`);
    })();
    return json({active_version:version});
  } catch (error) { return failure(error); }
}
