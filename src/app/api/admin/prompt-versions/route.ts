import { checkOrigin, requireAdmin } from '@/server/auth';
import { audit, db, getActivePrompt } from '@/server/db';
import { failure, json, readJson } from '@/server/http';
import { AppError } from '@/server/validation';
import { MIN_BENCHMARK_SAMPLES, versionBenchmarks } from '@/server/stats';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    requireAdmin(request);
    const versions = db().prepare('SELECT version,body,note,created_by,created_at FROM prompt_versions ORDER BY version DESC LIMIT 50').all();
    return json({active_version:getActivePrompt().version,versions,benchmarks:versionBenchmarks(),min_benchmark_samples:MIN_BENCHMARK_SAMPLES});
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    requireAdmin(request); checkOrigin(request);
    const body = await readJson(request,16_384) as Record<string,unknown>;
    if (!body || typeof body !== 'object' || typeof body.body !== 'string' || body.body.trim().length<100 || body.body.length>12000) throw new AppError('INVALID_INPUT',400,'系统提示词需为 100～12000 字符');
    if (typeof body.note !== 'string' || body.note.trim().length<4 || body.note.length>200) throw new AppError('INVALID_INPUT',400,'请填写至少 4 字的变更说明');
    if (!Number.isInteger(body.latest_version)) throw new AppError('INVALID_INPUT',400,'缺少版本号');
    const version = db().transaction(() => {
      const latest = (db().prepare('SELECT MAX(version) AS n FROM prompt_versions').get() as {n:number}).n;
      if (latest !== body.latest_version) throw new AppError('CONFIG_CONFLICT',409,'已有新版本，请刷新后重试');
      db().prepare('INSERT INTO prompt_versions(version,body,note,created_by,created_at) VALUES (?,?,?,?,?)')
        .run(latest+1,(body.body as string).trim(),(body.note as string).trim(),'admin',new Date().toISOString());
      audit('admin','create','prompt:'+String(latest+1),(body.note as string).trim());
      return latest+1;
    })();
    return json({saved:true,version},201);
  } catch (error) { return failure(error); }
}
