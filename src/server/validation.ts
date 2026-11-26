import type { EnhanceInput, EnhancementResult } from './types';
import { formatPromptSyntax } from './prompt-syntax';

export class AppError extends Error {
  constructor(public code: string, public status: number, message: string) { super(message); }
}

export const SCENE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const MAX_REFERENCE_IMAGES = 3;
/** ~5 MB of image data once decoded. */
const MAX_DATA_URL_LENGTH = 7_000_000;
/** Request body limit for endpoints that accept reference images (3 data URLs plus the rest). */
export const IMAGE_BODY_LIMIT = 22_000_000;
const DATA_URL_PATTERN = /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;

function parseReferenceImages(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length > MAX_REFERENCE_IMAGES) throw new AppError('INVALID_INPUT',400,`reference_images 必须是最多 ${MAX_REFERENCE_IMAGES} 项的数组`);
  const images = value.map((item,index) => {
    if (typeof item !== 'string') throw new AppError('INVALID_INPUT',400,`reference_images[${index}] 必须是字符串`);
    const image = item.trim();
    if (image.startsWith('data:')) {
      if (image.length > MAX_DATA_URL_LENGTH) throw new AppError('INVALID_INPUT',400,`reference_images[${index}] 超过 5 MB`);
      if (!DATA_URL_PATTERN.test(image)) throw new AppError('INVALID_INPUT',400,`reference_images[${index}] 须为 png、jpeg、webp 或 gif 的 base64 data URL`);
      return image;
    }
    let url: URL;
    try { url = new URL(image); } catch { throw new AppError('INVALID_INPUT',400,`reference_images[${index}] 不是有效的图片地址`); }
    if (!['http:','https:'].includes(url.protocol) || image.length > 2048) throw new AppError('INVALID_INPUT',400,`reference_images[${index}] 须为 http(s) 地址且不超过 2048 字符`);
    return image;
  });
  return images.length ? images : undefined;
}

/** The request as the text models and the text review see it: images are replaced by their analysis. */
export function textOnlyInput(input: EnhanceInput, analysis?: string): EnhanceInput {
  const {reference_images: _images, ...context} = input.context || {};
  if (!analysis) return {...input, context};
  const summary = [context.reference_summary, `参考图识别：${analysis}`].filter(Boolean).join('\n');
  return {...input, context:{...context, reference_summary:summary}};
}

/** Whether the request carries user-supplied context worth reviewing. entry is a fixed identifier, not user content. */
export function hasReviewableContext(input: EnhanceInput): boolean {
  return Object.entries(input.context||{}).some(([key,value])=>key!=='entry' && key!=='reference_images' && (Array.isArray(value)?value.length>0:Boolean(value)));
}

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function optionalText(value: unknown, field: string, max: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > max) throw new AppError('INVALID_INPUT', 400, `${field} 格式错误或过长`);
  return value.trim();
}

export function parseEnhanceInput(value: unknown): EnhanceInput {
  if (!object(value)) throw new AppError('INVALID_INPUT', 400, '请求体必须是对象');
  if (typeof value.text !== 'string' || value.text.length > 2000) throw new AppError('INVALID_INPUT', 400, 'text 必须是最多 2000 字符的字符串');
  const raw = value.text.trim();
  const context = value.context === undefined ? {} : value.context;
  if (!object(context)) throw new AppError('INVALID_INPUT', 400, 'context 必须是对象');
  const role = context.reference_role;
  if (role !== undefined && !['content','style','composition'].includes(String(role))) throw new AppError('INVALID_INPUT',400,'reference_role 不合法');
  const negatives = context.negative_constraints;
  if (negatives !== undefined && (!Array.isArray(negatives) || negatives.length > 10 || negatives.some(x => typeof x !== 'string' || x.length > 80))) {
    throw new AppError('INVALID_INPUT',400,'negative_constraints 格式错误');
  }
  const entry = context.entry;
  if (entry !== undefined && entry !== null && entry !== '' && (typeof entry !== 'string' || !SCENE_ID_PATTERN.test(entry))) {
    throw new AppError('INVALID_INPUT',400,'entry 格式错误');
  }
  return { text: raw, context: {
    scene: optionalText(context.scene,'scene',100),
    style: optionalText(context.style,'style',100),
    template: optionalText(context.template,'template',500),
    target_image_model: optionalText(context.target_image_model,'target_image_model',100),
    aspect_ratio: optionalText(context.aspect_ratio,'aspect_ratio',30),
    reference_summary: optionalText(context.reference_summary,'reference_summary',500),
    reference_role: role as 'content' | 'style' | 'composition' | undefined,
    negative_constraints: negatives?.map((x:string) => x.trim()),
    entry: typeof entry === 'string' && entry ? entry : undefined,
    reference_images: parseReferenceImages(context.reference_images),
  }};
}

export function isNoVisualSignal(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  const letters = [...trimmed].filter(c => /[\p{L}]/u.test(c)).join('');
  if (!letters) return true;
  if (letters.length < 2) return true;
  if (/^(.)\1{3,}$/u.test(letters)) return true;
  return false;
}

export function fallbackResult(scene: string, customNotice?: string): EnhancementResult {
  return {
    status: 'fallback', can_generate: true, intent_category: '默认家纺场景', prompt: formatPromptSyntax(scene),
    negative_prompt: '', preserved_constraints: [], assumptions: ['输入缺少可识别的视觉意图，采用后台默认家纺场景'],
    conflicts: [], user_notice: customNotice?.trim() || '未能从输入中识别明确意图，已按默认家纺场景生成可用示例。',
  };
}

/** The model judged the input too vague (status=clarify): ask the user for more detail instead of generating. */
export function needsClarificationResult(modelNotice = '', knownCategory?: string): EnhancementResult {
  return {
    status: 'needs_clarification', can_generate: false, intent_category: '需补充信息', prompt: '', negative_prompt: '',
    preserved_constraints: [], assumptions: [], conflicts: [],
    user_notice: modelNotice.trim().slice(0,300) || '描述信息不足，暂未生成提示词。请补充下面的要点后重新优化。',
    // When the product is already recognized, don't ask for it again.
    clarification_guidance: [
      ...(knownCategory?[]:['要展示的产品或主体，例如抱枕、床品四件套、窗帘']),
      knownCategory?`${knownCategory}的颜色、材质或花型，例如米色亚麻、蓝白条纹`:'颜色、材质或花型，例如米色亚麻、蓝白条纹',
      '使用场景或风格，例如卧室、客厅、简约自然',
    ],
  };
}

function stringArray(value: unknown, key: string): string[] {
  if (value === undefined || value === null) return [];
  if (typeof value === 'string') return value.trim() ? [value.trim().slice(0, 180)] : [];
  if (!Array.isArray(value) || value.length > 15 || value.some(item => typeof item !== 'string' || item.length > 180)) {
    throw new AppError('INVALID_MODEL_OUTPUT',502,`模型返回的 ${key} 不符合格式`);
  }
  return value.map(item => item.trim()).filter(Boolean);
}

function unwrapJsonText(raw: string): string {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced ? fenced[1].trim() : trimmed;
}

export function parseModelOutput(raw: string): EnhancementResult {
  let parsed: unknown;
  try { parsed = JSON.parse(unwrapJsonText(raw)); } catch { throw new AppError('INVALID_MODEL_OUTPUT',502,'模型未返回有效 JSON'); }
  if (!object(parsed)) throw new AppError('INVALID_MODEL_OUTPUT',502,'模型输出必须是对象');
  if (!['enhanced','fallback','clarify'].includes(String(parsed.status))) throw new AppError('INVALID_MODEL_OUTPUT',502,'模型状态无效');
  for (const field of ['intent_category','prompt','negative_prompt']) {
    if (typeof parsed[field] !== 'string') throw new AppError('INVALID_MODEL_OUTPUT',502,`模型返回的 ${field} 不符合格式`);
  }
  const rawNotice = parsed.user_notice;
  if (rawNotice !== undefined && rawNotice !== null && typeof rawNotice !== 'string' &&
      (!Array.isArray(rawNotice) || rawNotice.length>5 || rawNotice.some(item=>typeof item !== 'string' || item.length>300))) {
    throw new AppError('INVALID_MODEL_OUTPUT',502,'模型返回的 user_notice 不符合格式');
  }
  const prompt = (parsed.prompt as string).trim();
  if (prompt.length < 12 || prompt.length > 1200) throw new AppError('INVALID_MODEL_OUTPUT',502,'模型提示词长度无效');
  return {
    status: parsed.status as EnhancementResult['status'],
    can_generate: true,
    intent_category: (parsed.intent_category as string).trim().slice(0,100),
    prompt,
    negative_prompt: (parsed.negative_prompt as string).trim().slice(0,500),
    preserved_constraints: stringArray(parsed.preserved_constraints,'preserved_constraints'),
    assumptions: stringArray(parsed.assumptions,'assumptions'),
    conflicts: stringArray(parsed.conflicts,'conflicts'),
    user_notice: (typeof rawNotice === 'string' ? rawNotice : Array.isArray(rawNotice) ? rawNotice.join('；') : '').trim().slice(0,300),
  };
}

const anchors = ['米色','白色','黑色','红色','蓝色','绿色','粉色','黄色','紫色','橙色','亚麻','棉麻','丝绒','纯棉','真丝','羊毛','抱枕','床单','被套','四件套','窗帘','地毯','沙发','不要文字','不要人物','无文字','无人物'];

const anchorSynonyms: Record<string, string[]> = {
  纯棉: ['纯棉', '全棉', '长绒棉', '新疆棉', '100%棉'],
  真丝: ['真丝', '桑蚕丝'],
  丝绒: ['丝绒', '天鹅绒'],
  四件套: ['四件套', '床品套件'],
};

export function missingConstraints(input: EnhanceInput, result: EnhancementResult): string[] {
  const text = input.text;
  // Never trust the model's self-reported preserved_constraints as proof.
  // A negative_prompt is itself an exclusion list, so "文字" there preserves "不要文字".
  const excluded = (item:string) => {
    const target = item.replace(/^(?:不要|不含|无)/,'');
    const escaped = target.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const negativeWording = new RegExp(`(?:不要|不含|无|避免|不出现|不显示|严禁|禁止|不得|不可|不能|不允许)[^。；\\n]{0,20}${escaped}`);
    const exclusionField = new RegExp(`(?:排除项|避免|禁用)[:：][^。；\\n]{0,30}${escaped}`);
    return result.negative_prompt.includes(target) || result.prompt.includes(item) || negativeWording.test(result.prompt) || exclusionField.test(result.prompt);
  };
  const isPatternScene = input.context?.entry === 'pattern-layout' || /(?:无缝|平铺图案|面料印花|连续纹样)/u.test(text);
  const productCarrierWords = new Set(['抱枕', '床单', '被套', '四件套', '窗帘', '地毯', '沙发']);
  const hasPositiveAnchor = (anchor: string) => {
    const terms = anchorSynonyms[anchor] || [anchor];
    if (terms.some(t => result.prompt.includes(t))) return true;
    // 花型平铺设计中“用于四件套面料印花”只需呈现平面图案/面料肌理，不应强制画出立体四件套床铺
    if (isPatternScene && productCarrierWords.has(anchor) && /(?:图案|印花|纹样|面料|织物|平铺)/u.test(result.prompt)) return true;
    return false;
  };
  const fromText = anchors.filter(anchor => text.includes(anchor) &&
    (/^(?:不要|不含|无)/.test(anchor) ? !excluded(anchor) : !hasPositiveAnchor(anchor)));
  const fromContext = (input.context?.negative_constraints||[]).filter(item=>item && !excluded(item));
  return [...new Set([...fromText,...fromContext])];
}
