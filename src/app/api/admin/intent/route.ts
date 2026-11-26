import { checkOrigin, requireAdmin } from '@/server/auth';
import { listScenes } from '@/server/db';
import { failure, json, readJson } from '@/server/http';
import {
  getActiveIntentConfig,
  getIntentAnalytics,
  getIntentCandidateModel,
  listIntentCandidateModels,
  listIntentConfigVersions,
  probeIntentModel,
  publishIntentConfigVersion,
  recognizeUserIntent,
  rollbackIntentConfigVersion,
  type IntentActionDef,
  type IntentCategoryDef,
  type IntentFullConfig,
} from '@/server/intent-engine';
import { AppError, IMAGE_BODY_LIMIT, parseEnhanceInput } from '@/server/validation';

export const runtime = 'nodejs';

function validateIntentConfig(raw: unknown): IntentFullConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new AppError('INVALID_INPUT', 400, '意图配置格式无效');
  }
  const c = raw as Record<string, unknown>;
  const enabled = Boolean(c.enabled);
  const threshold = Number(c.confidence_threshold);
  if (!Number.isFinite(threshold) || threshold < 0.1 || threshold > 0.99) {
    throw new AppError('INVALID_INPUT', 400, '置信度阈值需在 0.10 ～ 0.99 之间');
  }

  const tc = (c.text_channel || {}) as Record<string, unknown>;
  const vc = (c.vision_channel || {}) as Record<string, unknown>;
  const textPrimary = String(tc.primary_model_id || '').trim();
  const textBackup = String(tc.backup_model_id || '').trim();
  const textTimeout = Math.round(Number(tc.timeout_ms) || 1500);
  if (!getIntentCandidateModel(textPrimary)) throw new AppError('INVALID_INPUT', 400, '纯文本主模型无效');
  if (textBackup && !getIntentCandidateModel(textBackup)) throw new AppError('INVALID_INPUT', 400, '纯文本备用模型无效');
  if (textTimeout < 300 || textTimeout > 15000) throw new AppError('INVALID_INPUT', 400, '纯文本超时上限需在 300 ～ 15000 ms 之间');

  const visPrimary = String(vc.primary_model_id || '').trim();
  const visBackup = String(vc.backup_model_id || '').trim();
  const visTimeout = Math.round(Number(vc.timeout_ms) || 3000);
  const triggerMaxChars = Math.max(0, Math.min(50, Math.round(Number(vc.trigger_max_chars) ?? 10)));
  const visModel = getIntentCandidateModel(visPrimary);
  if (!visModel || !visModel.supports_vision) throw new AppError('INVALID_INPUT', 400, '按需看图主模型必须支持多模态看图');
  if (visBackup) {
    const vb = getIntentCandidateModel(visBackup);
    if (!vb || !vb.supports_vision) throw new AppError('INVALID_INPUT', 400, '按需看图备用模型必须支持多模态看图');
  }
  if (visTimeout < 500 || visTimeout > 20000) throw new AppError('INVALID_INPUT', 400, '按需看图超时上限需在 500 ～ 20000 ms 之间');

  if (!Array.isArray(c.actions) || c.actions.length < 1 || c.actions.length > 20) {
    throw new AppError('INVALID_INPUT', 400, '创作动作需为 1 ～ 20 项');
  }
  const seenActions = new Set<string>();
  const actions: IntentActionDef[] = c.actions.map((item, idx) => {
    if (!item || typeof item !== 'object') throw new AppError('INVALID_INPUT', 400, `动作 #${idx + 1} 格式无效`);
    const rec = item as Record<string, unknown>;
    const id = String(rec.id || '').trim();
    const name = String(rec.name || '').trim();
    const instructions = String(rec.instructions || '').trim();
    const scene_id = String(rec.scene_id || '').trim();
    if (!/^[a-z0-9_]{2,32}$/.test(id) || id === 'none') {
      throw new AppError('INVALID_INPUT', 400, `动作标识 "${id}" 需为 2～32 位小写字母/数字/下划线且不能为 none`);
    }
    if (seenActions.has(id)) throw new AppError('INVALID_INPUT', 400, `动作标识 "${id}" 重复`);
    seenActions.add(id);
    if (!name || name.length > 30) throw new AppError('INVALID_INPUT', 400, `动作 "${id}" 名称需为 1～30 字`);
    if (!instructions || instructions.length > 400) throw new AppError('INVALID_INPUT', 400, `动作 "${name}" 判定说明需为 1～400 字`);
    const dedicated = Array.isArray(rec.dedicated_entries)
      ? rec.dedicated_entries.map((x) => String(x).trim()).filter(Boolean)
      : [];
    return {
      id,
      name,
      instructions,
      scene_id,
      dedicated_entries: dedicated,
      enabled: rec.enabled !== false,
    };
  });
  if (!actions.some((a) => a.enabled)) throw new AppError('INVALID_INPUT', 400, '至少需启用 1 个创作动作');

  if (!Array.isArray(c.categories) || c.categories.length < 1 || c.categories.length > 40) {
    throw new AppError('INVALID_INPUT', 400, '主题品类需为 1 ～ 40 项');
  }
  const seenCats = new Set<string>();
  const categories: IntentCategoryDef[] = c.categories.map((item, idx) => {
    if (!item || typeof item !== 'object') throw new AppError('INVALID_INPUT', 400, `品类 #${idx + 1} 格式无效`);
    const rec = item as Record<string, unknown>;
    const name = String(rec.name || '').trim();
    const description = String(rec.description || '').trim();
    if (!name || name.length > 24) throw new AppError('INVALID_INPUT', 400, `品类 #${idx + 1} 名称需为 1～24 字`);
    if (seenCats.has(name)) throw new AppError('INVALID_INPUT', 400, `品类 "${name}" 重复`);
    seenCats.add(name);
    if (description.length > 200) throw new AppError('INVALID_INPUT', 400, `品类 "${name}" 说明最多 200 字`);
    return { name, description, enabled: rec.enabled !== false };
  });
  if (!categories.some((cat) => cat.enabled)) throw new AppError('INVALID_INPUT', 400, '至少需启用 1 个主题品类');

  const clarifyNotice = String(c.clarify_notice || '').trim().slice(0, 300) || '描述中缺少具体主体，请补充要点后重试：';
  const fallbackNotice = String(c.fallback_notice || '').trim().slice(0, 300) || '未能从输入中识别明确生图意图，已返回当前场景默认示例。';

  return {
    enabled,
    confidence_threshold: Number(threshold.toFixed(2)),
    text_channel: {
      primary_model_id: textPrimary,
      backup_model_id: textBackup === textPrimary ? '' : textBackup,
      timeout_ms: textTimeout,
    },
    vision_channel: {
      primary_model_id: visPrimary,
      backup_model_id: visBackup === visPrimary ? '' : visBackup,
      timeout_ms: visTimeout,
      trigger_max_chars: triggerMaxChars,
    },
    actions,
    categories,
    clarify_notice: clarifyNotice,
    fallback_notice: fallbackNotice,
  };
}

export async function GET(request: Request) {
  try {
    requireAdmin(request);
    const active = getActiveIntentConfig();
    return json({
      active_version: active.version,
      config: active.config,
      versions: listIntentConfigVersions(),
      candidate_models: listIntentCandidateModels(),
      scenes: listScenes(),
      analytics: getIntentAnalytics(50),
    });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    requireAdmin(request);
    checkOrigin(request);
    const body = (await readJson(request, IMAGE_BODY_LIMIT)) as Record<string, unknown>;
    if (!body || typeof body !== 'object') throw new AppError('INVALID_INPUT', 400, '请求格式无效');

    const op = String(body.op || '');
    if (op === 'publish') {
      const validated = validateIntentConfig(body.config);
      const note = typeof body.note === 'string' ? body.note.trim().slice(0, 120) : '';
      const created = publishIntentConfigVersion(validated, note || '后台更新意图配置');
      return json({ ok: true, active_version: created.version, version: created });
    }

    if (op === 'rollback') {
      const targetVersion = Number(body.target_version);
      if (!Number.isInteger(targetVersion) || targetVersion < 1) {
        throw new AppError('INVALID_INPUT', 400, '目标回滚版本号无效');
      }
      const rolled = rollbackIntentConfigVersion(targetVersion);
      return json({ ok: true, active_version: rolled.version, version: rolled });
    }

    if (op === 'probe_model') {
      const modelId = String(body.model_id || '').trim();
      if (!modelId) throw new AppError('INVALID_INPUT', 400, '缺少 model_id');
      return json(await probeIntentModel(modelId));
    }

    if (op === 'test_input') {
      const parsedInput = parseEnhanceInput({
        text: typeof body.text === 'string' ? body.text : '',
        context: body.context && typeof body.context === 'object' ? body.context : {},
      });
      const intent = await recognizeUserIntent(parsedInput, { kind: 'test', recordLog: true });
      return json({ ok: true, intent });
    }

    throw new AppError('INVALID_INPUT', 400, `未知的操作类型: ${op}`);
  } catch (error) {
    return failure(error);
  }
}
