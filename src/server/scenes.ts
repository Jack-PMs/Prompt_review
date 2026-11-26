import { getScene } from './db';
import { AppError } from './validation';
import type { SceneConfig } from './types';

/** Missing entry means no scene (global defaults). An unknown or disabled entry is a caller error. */
export function resolveScene(entry: string | undefined): SceneConfig | null {
  if (!entry) return null;
  const scene = getScene(entry);
  if (!scene || !scene.enabled) throw new AppError('INVALID_SCENE',400,`使用场景 ${entry} 不存在或已停用`);
  return scene;
}

/** Scene rules may change content, but never the output format or JSON fields the server parses. */
export function withSceneRules(systemPrompt: string, scene: SceneConfig | null): string {
  if (!scene) return systemPrompt;
  const rules = scene.rules.trim();
  return `${systemPrompt}\n\n当前使用场景：${scene.name}（${scene.id}）。${rules
    ? `该场景的附加规则如下；输出格式与 JSON 字段要求保持不变（preserved_constraints 与 assumptions 请用简短词句，各不超过 4 项以加快响应）：\n${rules}`
    : ''}`;
}

export function sceneFallback(scene: SceneConfig | null, globalFallback: string): string {
  return scene?.fallback_scene.trim() || globalFallback;
}

export function validateSceneFields(body: Record<string,unknown>, current?: SceneConfig) {
  const name = typeof body.name === 'string' ? body.name.trim() : current?.name ?? '';
  const rules = typeof body.rules === 'string' ? body.rules.trim() : current?.rules ?? '';
  const fallback = typeof body.fallback_scene === 'string' ? body.fallback_scene.trim() : current?.fallback_scene ?? '';
  const enabled = typeof body.enabled === 'boolean' ? Number(body.enabled) : current?.enabled ?? 1;
  if (name.length < 1 || name.length > 30) throw new AppError('INVALID_INPUT',400,'场景名称需为 1～30 字符');
  if (rules.length > 1000) throw new AppError('INVALID_INPUT',400,'场景规则最多 1000 字符');
  if (fallback && (fallback.length < 15 || fallback.length > 800)) throw new AppError('INVALID_INPUT',400,'场景兜底稿需为空或 15～800 字符');
  return {name,rules,fallback_scene:fallback,enabled};
}
