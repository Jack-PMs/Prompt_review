import { checkOrigin, requireAdmin } from '@/server/auth';
import { audit, db, getSetting, listModels, setSetting } from '@/server/db';
import { failure, json, readJson } from '@/server/http';
import { keyBinding } from '@/server/providers';
import { reviewModelStatus } from '@/server/moderation';
import { visionModelStatus } from '@/server/vision';
import { decisionDb, getDecisionModel } from '@/server/decision/models';
import { AppError } from '@/server/validation';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    requireAdmin(request);
    decisionDb(); // ensures decision-model settings are seeded before they are read
    return json({active_model_id:getSetting('active_model_id'),backup_model_id:getSetting('backup_model_id'),vision_model_id:getSetting('vision_model_id'),vision_backup_model_id:getSetting('vision_backup_model_id'),intent_mode:getSetting('intent_mode')||'rules',decision_review_model_id:getSetting('decision_review_model_id'),decision_backup_model_id:getSetting('decision_backup_model_id'),decision_intent_model_id:getSetting('decision_intent_model_id'),vision_model:visionModelStatus(),fallback_scene:getSetting('fallback_scene'),
      revision:Number(getSetting('config_revision')||'1'),review_model:reviewModelStatus(),
      models:listModels().map(model=>({...model,key_env:keyBinding(model).env,key_configured:keyBinding(model).configured}))});
  } catch (error) { return failure(error); }
}

export async function PUT(request: Request) {
  try {
    requireAdmin(request); checkOrigin(request);
    const body = await readJson(request,4096) as Record<string,unknown>;
    if (!body || typeof body !== 'object') throw new AppError('INVALID_INPUT',400,'配置格式无效');
    const scene = body.fallback_scene;
    const modelId = body.active_model_id;
    if (typeof scene !== 'string' || scene.trim().length < 15 || scene.length > 800) throw new AppError('INVALID_INPUT',400,'默认场景需为 15～800 字符');
    if (typeof modelId !== 'string' || !listModels().some(m=>m.id===modelId && m.enabled)) throw new AppError('INVALID_INPUT',400,'默认模型无效');
    const backupId = body.backup_model_id ?? '';
    if (typeof backupId !== 'string' || (backupId && (backupId===modelId || !listModels().some(m=>m.id===backupId && m.enabled)))) throw new AppError('INVALID_INPUT',400,'备用模型需为空或与默认模型不同的已启用模型');
    const visionId = body.vision_model_id ?? getSetting('vision_model_id');
    const visionBackupId = body.vision_backup_model_id ?? getSetting('vision_backup_model_id');
    if (typeof visionId !== 'string' || !listModels().some(m=>m.id===visionId && m.enabled)) throw new AppError('INVALID_INPUT',400,'识图模型需为已启用的模型');
    if (typeof visionBackupId !== 'string' || (visionBackupId && (visionBackupId===visionId || !listModels().some(m=>m.id===visionBackupId && m.enabled)))) throw new AppError('INVALID_INPUT',400,'识图备用模型需为空或与识图模型不同的已启用模型');
    const intentMode = body.intent_mode ?? (getSetting('intent_mode')||'rules');
    if (intentMode!=='decisions' && intentMode!=='rules') throw new AppError('INVALID_INPUT',400,'意图识别方式无效');
    const decisionIds = {review:body.decision_review_model_id ?? getSetting('decision_review_model_id'),backup:body.decision_backup_model_id ?? getSetting('decision_backup_model_id'),intent:body.decision_intent_model_id ?? getSetting('decision_intent_model_id')};
    for (const [role,value] of Object.entries(decisionIds)) {
      if (typeof value!=='string' || (role!=='backup'||value) && !getDecisionModel(value)) throw new AppError('INVALID_INPUT',400,'判定模型选择无效');
    }
    if (!Number.isInteger(body.revision)) throw new AppError('INVALID_INPUT',400,'缺少配置版本');
    db().transaction(() => {
      const revision = Number(getSetting('config_revision')||'1');
      if (revision !== body.revision) throw new AppError('CONFIG_CONFLICT',409,'配置已被其他操作更新，请刷新后重试');
      setSetting('fallback_scene',scene.trim());
      setSetting('active_model_id',modelId);
      setSetting('backup_model_id',backupId);
      setSetting('vision_model_id',visionId);
      setSetting('vision_backup_model_id',visionBackupId);
      setSetting('intent_mode',intentMode);
      setSetting('decision_review_model_id',decisionIds.review as string);
      setSetting('decision_backup_model_id',decisionIds.backup===decisionIds.review||decisionIds.backup===decisionIds.intent?'':decisionIds.backup as string);
      setSetting('decision_intent_model_id',decisionIds.intent as string);
      setSetting('config_revision',String(revision+1));
      audit('admin','update','settings',`revision ${revision+1}`);
    })();
    return json({saved:true,revision:Number(getSetting('config_revision'))});
  } catch (error) { return failure(error); }
}
