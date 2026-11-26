import { randomUUID } from 'node:crypto';
import { db, getActivePrompt, getModel, getScene, getSetting, insertRun } from './db';
import { buildUserMessage } from './prompt';
import { formatPromptSyntax } from './prompt-syntax';
import { callProvider, hasProviderKey } from './providers';
import { resolveScene, withSceneRules } from './scenes';
import { describeReferenceImagesOnly } from './vision';
import { recognizeUserIntent, type StructuredIntentOutput } from './intent-engine';
import {
  AppError,
  missingConstraints,
  parseEnhanceInput,
  parseModelOutput,
  textOnlyInput,
} from './validation';
import type { EnhanceInput, EnhancementResult, ModelConfig, RunRecord, SceneConfig } from './types';

/** Channel-level failures that a different model/channel can plausibly recover from. */
const FAILOVER_CODES = ['PROVIDER_TIMEOUT', 'PROVIDER_ERROR', 'PROVIDER_UNAVAILABLE', 'PROVIDER_RATE_LIMITED', 'PROVIDER_NOT_CONFIGURED'];

/** 判断当前选用的强化模型是否原生支持多模态看图 */
function isVisionCapableEnhanceModel(model: ModelConfig): boolean {
  if (model.provider === 'deepseek') return false;
  if (model.model.includes('deepseek') && !model.model.includes('vision')) return false;
  if (model.provider === 'runninghub') {
    return /^(?:bytedance\/doubao-seed-2\.1|qwen\/|glm\/glm-\d+v)/i.test(model.model) || model.model.includes('vision');
  }
  return ['qwen', 'gemini', 'openai', 'apiyi', 'bananarouter'].includes(model.provider);
}

function backupModelFor(primary: ModelConfig): ModelConfig | null {
  const id = getSetting('backup_model_id');
  const backup = id && id !== primary.id ? getModel(id) : undefined;
  return backup?.enabled && hasProviderKey(backup.provider) ? backup : null;
}

function buildIntentHintsForEnhancer(intent: StructuredIntentOutput | null): Record<string, string | boolean> | undefined {
  if (!intent || intent.status !== 'ok') return undefined;
  const hints: Record<string, string | boolean> = {
    action: intent.action,
    action_label: intent.action_label,
    wants_rendered_text: intent.wants_rendered_text,
    has_exclusions: intent.has_exclusions,
  };
  if (intent.category?.value) hints.category = intent.category.value;
  if (intent.routed_scene_id) hints.routed_scene = intent.routed_scene_id;
  return hints;
}

export interface EnhanceOptions {
  kind: RunRecord['kind'];
  modelId?: string;
  promptVersion?: number;
  actor?: string;
}

/**
 * 提示词强化主链路（零拦截原则）：
 * 仅聚焦「豆包意图识别 → 路由匹配专属强化场景 → 所选强化模型严格围绕用户原文强化」，
 * 不在此链路设置内容审核拦截、模糊追问拦截或乱码兜底替换。
 */
export async function enhance(rawInput: unknown, options: EnhanceOptions) {
  const input: EnhanceInput = parseEnhanceInput(rawInput);
  const explicitScene = resolveScene(input.context?.entry);
  const activePrompt = getActivePrompt();
  const prompt = options.promptVersion
    ? (db().prepare('SELECT version,body FROM prompt_versions WHERE version=?').get(options.promptVersion) as { version: number; body: string } | undefined)
    : activePrompt;
  if (!prompt) throw new AppError('PROMPT_NOT_FOUND', 404, '提示词版本不存在');
  const modelId = options.modelId || getSetting('active_model_id');
  const model = getModel(modelId);
  if (!model || !model.enabled) throw new AppError('MODEL_UNAVAILABLE', 503, '所选模型未启用');

  let usedModel: ModelConfig = model;
  let failoverFrom: string | null = null;
  let effectiveScene: SceneConfig | null = explicitScene;
  const id = randomUUID();
  const start = performance.now();
  let upstreamMs = 0;
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  let attempts = 0;
  let result: EnhancementResult | null = null;
  let errorCode: string | null = null;
  const images = input.context?.reference_images || [];
  let visionModelId: string | null = null;
  let visionMs = 0;
  let modelInput: EnhanceInput = textOnlyInput(input);
  let intent: StructuredIntentOutput | null = null;

  async function runModel(target: ModelConfig, activeScene: SceneConfig | null, directImages?: string[]): Promise<EnhancementResult> {
    const systemPrompt = withSceneRules(prompt!.body, activeScene);
    const userMessage = buildUserMessage(modelInput, undefined, buildIntentHintsForEnhancer(intent));
    let retryInstruction = '';
    for (let attempt = 0; ; attempt++) {
      attempts++;
      const upstreamStart = performance.now();
      let providerCompleted = false;
      try {
        const output = await callProvider(
          target,
          systemPrompt + retryInstruction,
          userMessage,
          directImages?.length ? { images: directImages } : {},
        );
        providerCompleted = true;
        upstreamMs += output.upstreamMs;
        if (output.inputTokens !== null) inputTokens = (inputTokens || 0) + output.inputTokens;
        if (output.outputTokens !== null) outputTokens = (outputTokens || 0) + output.outputTokens;
        const parsed = parseModelOutput(output.content);
        const enhanced: EnhancementResult = {
          ...parsed,
          status: 'enhanced',
          can_generate: true,
          prompt: formatPromptSyntax(parsed.prompt, input),
        };
        const missing = missingConstraints(input, enhanced);
        if (missing.length) throw new AppError('CONSTRAINT_MISSING', 502, `模型遗漏明确约束：${missing.join('、')}`);
        return enhanced;
      } catch (error) {
        if (!providerCompleted) upstreamMs += Math.round(performance.now() - upstreamStart);
        if (attempt === 0 && error instanceof AppError && ['INVALID_MODEL_OUTPUT', 'CONSTRAINT_MISSING'].includes(error.code)) {
          retryInstruction =
            error.code === 'CONSTRAINT_MISSING'
              ? `\n\n修正上一次输出：必须在 prompt 中保留这些明确要求并保持分段字段语法：${error.message.replace(/^模型遗漏明确约束：/u, '')}。仍只返回规定的 JSON 对象。`
              : '\n\n修正上一次输出：必须返回完整且有效的 JSON 对象，包含所有必需字段，prompt 保持分段字段语法。';
          continue;
        }
        throw error;
      }
    }
  }

  async function runEnhancement(activeScene: SceneConfig | null, directImages?: string[]): Promise<EnhancementResult> {
    try {
      return await runModel(usedModel, activeScene, directImages);
    } catch (error) {
      const backup = options.kind === 'live' && !options.modelId ? backupModelFor(usedModel) : null;
      if (!backup || !(error instanceof AppError) || !FAILOVER_CODES.includes(error.code)) throw error;
      failoverFrom = usedModel.id;
      usedModel = backup;
      return await runModel(backup, activeScene, isVisionCapableEnhanceModel(backup) ? directImages : undefined);
    }
  }

  try {
    if (!input.text.trim() && !images.length) {
      throw new AppError('INVALID_INPUT', 400, '请输入提示词文字或上传参考图');
    }

    // 1. 豆包意图识别（纯文本通道 / 无字传图按需看图通道），不做任何拦截
    const visionCapablePrimary = isVisionCapableEnhanceModel(usedModel);
    const intentTask = recognizeUserIntent(input, { kind: options.kind === 'live' ? 'live' : 'playground' });
    // 仅当所选强化模型不支持直接看图且有参考图时，才并发提取纯视觉描述（绝不做审核拦截）
    const visionDescTask = images.length && !visionCapablePrimary
      ? (async () => {
          const started = performance.now();
          try {
            const desc = await describeReferenceImagesOnly(input);
            visionModelId = desc.modelId;
            return desc;
          } finally {
            visionMs = Math.round(performance.now() - started);
          }
        })()
      : null;

    intent = await intentTask;
    if (intent.routed_scene_id && (!explicitScene || explicitScene.id === 'home')) {
      const candidateScene = getScene(intent.routed_scene_id);
      if (candidateScene && candidateScene.enabled) {
        effectiveScene = candidateScene;
      }
    }

    // 2. 围绕用户原文执行提示词强化（支持看图的模型单跳直接看参考图强化，零中间拦截）
    let refSummaryText = '';
    if (visionDescTask) {
      const desc = await visionDescTask;
      refSummaryText = desc.description;
      modelInput = textOnlyInput(input, desc.description);
    }

    result = await runEnhancement(effectiveScene, images.length && visionCapablePrimary ? images : undefined);
    if (refSummaryText) {
      result = { ...result, reference_analysis: refSummaryText };
    }

    // 挂载专用页冲突提示与意图识别结果
    if (result && intent) {
      const mergedConflicts = intent.entry_conflict && !result.conflicts.includes(intent.entry_conflict)
        ? [intent.entry_conflict, ...result.conflicts]
        : result.conflicts;
      const mergedNotice = intent.entry_conflict && !result.user_notice
        ? intent.entry_conflict
        : result.user_notice;
      result = {
        ...result,
        conflicts: mergedConflicts,
        user_notice: mergedNotice,
        intent,
      };
    }

    return {
      request_id: id,
      model_id: usedModel.id,
      prompt_version: prompt.version,
      routed_scene: effectiveScene?.id ?? null,
      result: result!,
      metrics: {
        total_ms: Math.round(performance.now() - start),
        upstream_ms: upstreamMs,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        attempts,
        review_attempts: 0,
        review_ms: 0,
        review_model_id: null,
        failover_from: failoverFrom,
        image_count: images.length,
        vision_ms: visionMs,
        vision_model_id: visionModelId,
        intent_ms: intent?.latency_ms ?? 0,
        intent_check: intent?.status ?? 'off',
        intent_channel: intent?.channel ?? null,
        intent_model_id: intent?.model_id ?? null,
      },
    };
  } catch (error) {
    errorCode = error instanceof AppError ? error.code : 'INTERNAL_ERROR';
    result = null;
    throw error;
  } finally {
    insertRun({
      id,
      kind: options.kind,
      model_id: usedModel.id,
      failover_from: failoverFrom,
      prompt_version: prompt.version,
      entry: effectiveScene?.id ?? explicitScene?.id ?? null,
      status: result ? 'success' : 'failed',
      intent_status: result?.status || null,
      attempts,
      review_attempts: 0,
      review_ms: 0,
      review_model_id: null,
      image_count: images.length,
      vision_ms: visionMs,
      vision_model_id: visionModelId,
      intent_ms: intent?.latency_ms ?? 0,
      intent_check: intent?.status ?? null,
      total_ms: Math.round(performance.now() - start),
      upstream_ms: upstreamMs,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      error_code: errorCode,
      input_text: options.kind === 'live' ? null : input.text,
      output_json: options.kind === 'live' || !result ? null : JSON.stringify(result),
      created_at: new Date().toISOString(),
    });
  }
}
