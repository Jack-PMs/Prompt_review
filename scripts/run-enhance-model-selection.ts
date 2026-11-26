/**
 * 提示词强化模型选型实测脚本（零修改当前系统代码与数据库配置）
 *
 * 参评阵容（9 款 2026 主流/新锐模型，覆盖 5 大模型家族与 4 大渠道）：
 * [A 组 · 当前系统已启用 4 款 — 直接走当前系统线上接口 /api/admin/playground 端到端实测]
 *   1. qwen3.8-flash                 (阿里云百炼直连 · 当前线上主模型 · 原生看图)
 *   2. gemini-3.5-flash-lite         (BananaRouter · 当前线上备用模型 · 原生看图)
 *   3. gpt-6-luna                    (API易 · OpenAI 轻量系 · 原生看图)
 *   4. deepseek/deepseek-v4.1-flash  (RunningHub · DeepSeek 极速系 · 纯文本+系统辅助识图)
 *
 * [B 组 · 本次新调研高潜力 5 款 — 动态读取当前系统 V5 提示词/场景/豆包意图路由，离线同口径拉齐]
 *   5. qwen3.8-max                   (阿里云百炼直连 · 阿里最新旗舰 · 质量天花板参照 · 原生看图)
 *   6. gemini-3.8-flash              (API易 · Google 最新代 Flash · 原生看图)
 *   7. gpt-6.2-sol                   (API易 · OpenAI 最新旗舰 · 质量天花板参照 · 原生看图)
 *   8. claude-haiku-4-5-20251001     (API易 · Anthropic 轻量强遵从标杆 · 原生看图)
 *   9. bytedance/doubao-seed-2.1-lite(RunningHub · 字节豆包 2.1 Lite · 与意图模型同源)
 */

import fs from 'node:fs';
import path from 'node:path';
import { buildUserMessage } from '../src/server/prompt';
import { formatPromptSyntax, isPromptSyntax } from '../src/server/prompt-syntax';
import { missingConstraints, parseEnhanceInput, parseModelOutput, textOnlyInput } from '../src/server/validation';
import type { EnhanceInput, EnhancementResult } from '../src/server/types';

// 加载 .env（只读，不修改系统）
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!(key in process.env)) process.env[key] = val;
  }
}

const BASE_URL = 'http://127.0.0.1:6770';
const OUT_JSON = path.resolve(process.cwd(), 'data/enhance-model-selection-10cases.json');

export interface ModelSpec {
  id: string;
  model: string;
  displayName: string;
  vendor: string;
  channel: string;
  group: 'system_live' | 'survey_candidate';
  systemModelId?: string;
  endpoint?: string;
  keyEnv?: string;
  nativeVision: boolean;
  /** RMB per 1M tokens (input / output), based on official / APIYI 2026-11 registry (USD * 7.25) */
  inputCnyPer1M: number;
  outputCnyPer1M: number;
  priceSource: string;
  extraBody?: Record<string, unknown>;
  useJsonSchema?: boolean;
  note: string;
}

export const MODELS: ModelSpec[] = [
  // A 组：当前系统已启用 4 款（直接走线上 /api/admin/playground）
  {
    id: 'sys-qwen3.8-flash',
    model: 'qwen3.8-flash',
    displayName: 'Qwen 3.8 Flash',
    vendor: '阿里通义',
    channel: '阿里云百炼直连（系统主选）',
    group: 'system_live',
    systemModelId: 'qwen-flash',
    nativeVision: true,
    inputCnyPer1M: 0.30,
    outputCnyPer1M: 1.80,
    priceSource: '百炼官方标价参考',
    note: '当前系统线上默认强化主模型',
  },
  {
    id: 'sys-gemini-3.5-flash-lite',
    model: 'gemini-3.5-flash-lite',
    displayName: 'Gemini 3.5 Flash Lite',
    vendor: 'Google',
    channel: 'BananaRouter（系统备选）',
    group: 'system_live',
    systemModelId: 'gemini-flash-lite',
    nativeVision: true,
    inputCnyPer1M: 2.18,
    outputCnyPer1M: 18.12,
    priceSource: 'APIYI/网关同档标价 ($0.30/$2.50)',
    note: '当前系统线上异构备用模型',
  },
  {
    id: 'sys-gpt-6-luna',
    model: 'gpt-6-luna',
    displayName: 'GPT-6-Luna',
    vendor: 'OpenAI',
    channel: 'API易（系统已启用）',
    group: 'system_live',
    systemModelId: 'gpt-luna',
    nativeVision: true,
    inputCnyPer1M: 0.73,
    outputCnyPer1M: 3.63,
    priceSource: 'API易实时价目 ($0.10/$0.50)',
    note: '当前系统已启用 OpenAI 轻量系',
  },
  {
    id: 'sys-deepseek-v4.1-flash',
    model: 'deepseek/deepseek-v4.1-flash',
    displayName: 'DeepSeek V4.1 Flash',
    vendor: 'DeepSeek',
    channel: 'RunningHub（系统已启用）',
    group: 'system_live',
    systemModelId: 'runninghub-deepseek',
    nativeVision: false,
    inputCnyPer1M: 2.18,
    outputCnyPer1M: 8.70,
    priceSource: 'APIYI/同模型标价 ($0.30/$1.20)',
    note: '纯文本模型，传图自动走系统辅助识图',
  },

  // B 组：本次渠道调研新发现的 5 款 2026 高潜力候选模型（零修改系统，离线同口径拉齐）
  {
    id: 'new-qwen3.8-max',
    model: 'qwen3.8-max',
    displayName: 'Qwen 3.8 Max',
    vendor: '阿里通义',
    channel: '阿里云百炼直连（新调研）',
    group: 'survey_candidate',
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    keyEnv: 'DASHSCOPE_API_KEY',
    nativeVision: true,
    inputCnyPer1M: 11.96,
    outputCnyPer1M: 35.89,
    priceSource: 'APIYI/百炼旗舰价 ($1.65/$4.95)',
    extraBody: { enable_thinking: false },
    note: '阿里最新旗舰，验证中文视觉文笔天花板',
  },
  {
    id: 'new-gemini-3.8-flash',
    model: 'gemini-3.8-flash',
    displayName: 'Gemini 3.8 Flash',
    vendor: 'Google',
    channel: 'API易（新调研）',
    group: 'survey_candidate',
    endpoint: 'https://api.apiyi.com/v1/chat/completions',
    keyEnv: 'APIYI_API_KEY',
    nativeVision: true,
    inputCnyPer1M: 5.44,
    outputCnyPer1M: 27.19,
    priceSource: 'API易实时价目 ($0.75/$3.75)',
    useJsonSchema: true,
    note: 'Google 最新代 Flash，对比 3.5-flash-lite 代际提升',
  },
  {
    id: 'new-gpt-6.2-sol',
    model: 'gpt-6.2-sol',
    displayName: 'GPT-6.2-Sol',
    vendor: 'OpenAI',
    channel: 'API易（新调研）',
    group: 'survey_candidate',
    endpoint: 'https://api.apiyi.com/v1/chat/completions',
    keyEnv: 'APIYI_API_KEY',
    nativeVision: true,
    inputCnyPer1M: 14.50,
    outputCnyPer1M: 72.50,
    priceSource: 'API易实时价目 ($2.00/$10.00)',
    useJsonSchema: true,
    note: 'OpenAI 最新旗舰级主力，质量天花板参照',
  },
  {
    id: 'new-claude-haiku-4.5',
    model: 'claude-haiku-4-5-20251001',
    displayName: 'Claude 4.5 Haiku',
    vendor: 'Anthropic',
    channel: 'API易（新调研）',
    group: 'survey_candidate',
    endpoint: 'https://api.apiyi.com/v1/chat/completions',
    keyEnv: 'APIYI_API_KEY',
    nativeVision: true,
    inputCnyPer1M: 7.25,
    outputCnyPer1M: 36.25,
    priceSource: 'API易实时价目 ($1.00/$5.00)',
    note: 'Anthropic 轻量强指令遵从标杆',
  },
  {
    id: 'new-doubao-seed-2.1-lite',
    model: 'bytedance/doubao-seed-2.1-lite',
    displayName: '豆包 Seed 2.1 Lite',
    vendor: '字节跳动',
    channel: 'RunningHub（新调研）',
    group: 'survey_candidate',
    endpoint: 'https://llm.runninghub.cn/v1/chat/completions',
    keyEnv: 'RUNNINGHUB_API_KEY',
    nativeVision: false, // RunningHub 渠道实测对 image_url 报 400，改用系统同款辅助识图描述
    inputCnyPer1M: 0.80,
    outputCnyPer1M: 2.00,
    priceSource: '火山/LoopRouter 同档标价参考',
    extraBody: { thinking: { type: 'disabled' } },
    note: '与已选意图模型同源，验证轻量国产极速性价比',
  },
];

export interface TestCase {
  id: string;
  category: string;
  title: string;
  text: string;
  imageFile?: string;
  entry?: string;
  expectedChecks: string;
  mustIncludeAny?: string[][];
  mustNotInclude?: string[];
  expectRenderedQuote?: string;
  forbidQuote?: string;
}

export const CASES: TestCase[] = [
  {
    id: 'E01',
    category: '文生图 · 标准商拍+双排除',
    title: '家纺标准描述 + 双排除约束',
    text: '米色粗亚麻方形抱枕，摆放在北欧原木客厅沙发上，不要文字，不要人物',
    expectedChecks: '保留米色/亚麻/抱枕/沙发，并把不要文字、不要人物双写进 [限制] 与 negative_prompt',
    mustIncludeAny: [['米色'], ['亚麻'], ['抱枕'], ['沙发']],
  },
  {
    id: 'E02',
    category: '文生图 · 混合引号+否定冲突',
    title: '“云朵”商品名去引号 + “晚安”精准保留 + 排斥其他文字',
    text: '奶油白“云朵”纯棉四件套，不要多余文字，但枕套右下角绣上“晚安”字样',
    expectedChecks: '云朵不加引号，晚安必须用“晚安”圈出，限制段写成不要其他文字而非一刀切禁止文字',
    mustIncludeAny: [['纯棉', '全棉', '长绒棉'], ['四件套', '床品'], ['晚安']],
    expectRenderedQuote: '“晚安”',
    forbidQuote: '“云朵”',
  },
  {
    id: 'E03',
    category: '文生图 · 极简短词',
    title: '极简 Emoji 短词合理视觉补全',
    text: '🌸床单',
    expectedChecks: '围绕樱花/花卉床单补全高清材质、配色与自然卧室氛围，不拒答不跑偏',
    mustIncludeAny: [['床单'], ['樱花', '花', '粉']],
  },
  {
    id: 'E04',
    category: '花型平铺 · 四方连续',
    title: '无缝循环平铺印花（禁止立体家具透视）',
    text: '法式田园蓝白小雏菊与藤蔓无缝循环平铺印花图案，用于全棉四件套面料设计',
    expectedChecks: '自动路由至花型排版规则，强调正交俯视、无缝四方连续平面图案，不画立体床铺沙发',
    mustIncludeAny: [['雏菊'], ['平铺', '无缝', '连续', '俯视']],
  },
  {
    id: 'E05',
    category: '真人模特 · 居家展示',
    title: '真人模特与真丝睡衣自然互动展示',
    text: '年轻亚洲女模特身穿香槟色真丝睡衣坐在清晨阳光卧室床边',
    expectedChecks: '自动路由至真人模特规则，刻画人物自然姿态与香槟色真丝垂坠光泽，不过度空洞堆词',
    mustIncludeAny: [['模特', '女性'], ['香槟'], ['真丝', '桑蚕丝'], ['睡衣']],
  },
  {
    id: 'E06',
    category: '边界泛化 · 情绪语气词',
    title: '无具象主体的情绪叠词「啊啊啊啊啊」',
    text: '啊啊啊啊啊',
    expectedChecks: '零拦截、绝不偷换抱枕，将呐喊/崩溃/释放情绪与原文字转化成高张力视觉画面',
    mustNotInclude: ['抱枕', '四件套'],
  },
  {
    id: 'E07',
    category: '边界泛化 · 纯数字字符',
    title: '无主体纯数字「111111111」',
    text: '111111111',
    expectedChecks: '零拦截、绝不偷换抱枕，将数字 111111111 本身锚定为立体艺术字/光影视觉主体',
    mustIncludeAny: [['111111111', '九个1', '9个1', '数字1']],
    mustNotInclude: ['抱枕', '四件套'],
  },
  {
    id: 'E08',
    category: '边界泛化 · 版权IP零拦截',
    title: '卡通版权 IP 儿童四件套（零审核拦截）',
    text: '皮卡丘和哆啦A梦卡通图案儿童纯棉四件套，温馨儿童房，柔和自然光',
    expectedChecks: '提示词强化彻底零审核拦截，完整保留皮卡丘和哆啦A梦元素并做自然扩写',
    mustIncludeAny: [['皮卡丘'], ['哆啦A梦'], ['四件套', '床品']],
  },
  {
    id: 'E09',
    category: '图生图 · 三笙真图换背景',
    title: '三笙实拍图换法式阳光卧室背景',
    text: '换个法式阳光卧室背景，保持产品花色不变',
    imageFile: 'data/image_benchmark_120/IMG-111.jpg',
    expectedChecks: '准确读出图内商品并路由 product-reshoot，强调主体款式花色严格不变、重点刻画法式阳光卧室新环境与融合光影',
    mustIncludeAny: [['法式'], ['卧室']],
  },
  {
    id: 'E10',
    category: '图生图 · 三笙真图局部改图',
    title: '三笙实拍图去文字去水印局部编辑',
    text: '把图片里的文字和水印全去掉，其余保持原样',
    imageFile: 'data/image_benchmark_120/IMG-112.jpg',
    expectedChecks: '路由 local-edit，采用精准简洁局部编辑指令，明确去除文字/水印并声明原图主体构图光影保持不变',
    mustIncludeAny: [['文字', '水印'], ['不变', '原样', '保留']],
  },
];

const enhancementSchema = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['enhanced', 'fallback', 'clarify'] },
    intent_category: { type: 'string' },
    prompt: { type: 'string' },
    negative_prompt: { type: 'string' },
    preserved_constraints: { type: 'array', items: { type: 'string' } },
    assumptions: { type: 'array', items: { type: 'string' } },
    conflicts: { type: 'array', items: { type: 'string' } },
    user_notice: { type: 'string' },
  },
  required: ['status', 'intent_category', 'prompt', 'negative_prompt', 'preserved_constraints', 'assumptions', 'conflicts', 'user_notice'],
  additionalProperties: false,
} as const;

function imageFileToDataUrl(relPath: string): string {
  const abs = path.resolve(process.cwd(), relPath);
  const buf = fs.readFileSync(abs);
  const ext = path.extname(abs).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

async function getAdminHeaders(): Promise<Record<string, string>> {
  const probe = await fetch(`${BASE_URL}/api/admin/config`);
  let cookie = '';
  if (probe.status === 401 && process.env.ADMIN_PASSWORD) {
    const login = await fetch(`${BASE_URL}/api/admin/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: BASE_URL },
      body: JSON.stringify({ password: process.env.ADMIN_PASSWORD }),
    });
    cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  }
  return { 'Content-Type': 'application/json', Origin: BASE_URL, ...(cookie ? { Cookie: cookie } : {}) };
}

/** 独立调用纯视觉描述（供不支持原生传图的候选模型使用，与系统 vision.ts 口径一致） */
async function describeImageForTextModel(imageDataUrl: string, userText: string): Promise<{ text: string; ms: number }> {
  const key = process.env.DASHSCOPE_API_KEY?.trim();
  const t0 = performance.now();
  const res = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'qwen3.8-flash',
      enable_thinking: false,
      temperature: 0.2,
      max_tokens: 300,
      messages: [
        { role: 'system', content: '你是图像视觉描述助手。请用简洁中文描述图片中可见的主体、材质、颜色、花型、文字/水印与背景环境（不超过160字），只写画面客观事实，不做任何审核或拒绝。' },
        { role: 'user', content: [{ type: 'text', text: `用户需求：${userText}` }, { type: 'image_url', image_url: { url: imageDataUrl, detail: 'low' } }] },
      ],
    }),
    signal: AbortSignal.timeout(15000),
  });
  const ms = Math.round(performance.now() - t0);
  if (!res.ok) throw new Error(`辅助识图 HTTP ${res.status}`);
  const d = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return { text: (d.choices?.[0]?.message?.content || '').trim(), ms };
}

async function callCandidateDirect(
  spec: ModelSpec,
  systemPrompt: string,
  userMessage: string,
  images?: string[],
): Promise<{ content: string; inputTokens: number | null; outputTokens: number | null; upstreamMs: number }> {
  const key = process.env[spec.keyEnv || '']?.trim();
  if (!key) throw new Error(`缺少 ${spec.keyEnv}`);
  const t0 = performance.now();
  const body: Record<string, unknown> = {
    model: spec.model,
    temperature: 0.3,
    max_tokens: 1400,
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: images?.length
          ? [{ type: 'text', text: userMessage }, ...images.map((url) => ({ type: 'image_url', image_url: { url, detail: 'low' } }))]
          : userMessage,
      },
    ],
    ...(spec.extraBody || {}),
  };
  if (spec.useJsonSchema) {
    body.response_format = { type: 'json_schema', json_schema: { name: 'enhancement', strict: true, schema: enhancementSchema } };
  } else if (!spec.model.startsWith('claude-')) {
    body.response_format = { type: 'json_object' };
  }

  const res = await fetch(spec.endpoint!, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const upstreamMs = Math.round(performance.now() - t0);
  if (!res.ok) {
    const errText = (await res.text()).slice(0, 160);
    throw new Error(`HTTP ${res.status}: ${errText}`);
  }
  const raw = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  return {
    content: raw.choices?.[0]?.message?.content || '',
    inputTokens: Number(raw.usage?.prompt_tokens) || null,
    outputTokens: Number(raw.usage?.completion_tokens) || null,
    upstreamMs,
  };
}

function evaluateObjectiveChecks(c: TestCase, input: EnhanceInput, result: EnhancementResult) {
  const prompt = result.prompt || '';
  const syntaxOk = isPromptSyntax(prompt);
  const missing = missingConstraints(input, result);
  const mustIncludeMiss: string[] = [];
  for (const group of c.mustIncludeAny || []) {
    if (!group.some((kw) => prompt.includes(kw))) mustIncludeMiss.push(group.join('/'));
  }
  const forbiddenHit = (c.mustNotInclude || []).filter((kw) => prompt.includes(kw));
  const quoteOk =
    (!c.expectRenderedQuote || prompt.includes(c.expectRenderedQuote)) &&
    (!c.forbidQuote || !prompt.includes(c.forbidQuote));
  const zeroBlockOk = result.status === 'enhanced' && prompt.length >= 20;
  const allChecksPass = syntaxOk && missing.length === 0 && mustIncludeMiss.length === 0 && forbiddenHit.length === 0 && quoteOk && zeroBlockOk;
  return { syntaxOk, missing, mustIncludeMiss, forbiddenHit, quoteOk, zeroBlockOk, allChecksPass };
}

interface RunOutcome {
  ok: boolean;
  error?: string;
  prompt: string;
  negative_prompt: string;
  intent_category: string;
  assumptions: string[];
  attempts: number;
  total_ms: number;
  upstream_ms: number;
  intent_ms: number;
  vision_ms: number;
  input_tokens: number | null;
  output_tokens: number | null;
  prompt_chars: number;
  checks?: ReturnType<typeof evaluateObjectiveChecks>;
  judgeScores?: {
    qwenMax?: { total: number; faithfulness: number; visual: number; format: number; edge: number; comment: string };
    gpt62?: { total: number; faithfulness: number; visual: number; format: number; edge: number; comment: string };
    avgScore: number;
  };
}

/** 匿名跨厂商双裁判盲评（每题随机打乱 9 个候选输出，隐藏模型名） */
async function blindJudgeCase(
  c: TestCase,
  outputs: Array<{ modelId: string; prompt: string; negative_prompt: string; ok: boolean }>,
  judge: { name: string; endpoint: string; key: string; model: string; extra?: Record<string, unknown> },
): Promise<Record<string, { total: number; faithfulness: number; visual: number; format: number; edge: number; comment: string }>> {
  const valid = outputs.filter((o) => o.ok && o.prompt);
  if (!valid.length) return {};
  // 随机洗牌并赋予匿名标签
  const shuffled = [...valid].sort(() => Math.random() - 0.5);
  const aliasToModel = new Map<string, string>();
  const labels = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
  const itemsText = shuffled
    .map((item, idx) => {
      const alias = `候选${labels[idx]}`;
      aliasToModel.set(alias, item.modelId);
      return `### ${alias}\n${item.prompt}\n[negative_prompt]: ${item.negative_prompt || '（空）'}`;
    })
    .join('\n\n');

  const sys = `你是资深AI图像生成提示词评审专家。请对多个匿名候选模型的强化输出进行严格、拉开差距的盲评打分（满分100分）：
- faithfulness（0-30分）：是否忠实保留用户所有主体/材质/颜色/花型/文字/排除约束，有无幻觉、偷换主题或拒答；
- visual（0-40分）：视觉画面描述是否具象、高级、构图光影材质清晰、能直接交给主流生图模型出高质量图（避免空洞套话）；
- format（0-20分）：分段字段结构是否清晰简洁、引号是否规范（仅需画面渲染文字加引号）、是否贴合场景规则（如花型平铺不画立体床、局部改图简洁不重绘整图）；
- edge（0-10分）：面对短词/情绪词/纯数字/版权IP等边界输入的泛化自然度与精炼度。

只返回纯 JSON 对象：
{"scores":[{"alias":"候选A","faithfulness":28,"visual":35,"format":18,"edge":9,"total":90,"comment":"20字内简评"}]}`;

  const user = `【测试题 ${c.id}｜${c.category}】
用户原始输入：${c.text}
${c.imageFile ? '（附带三笙真实商品参考图）' : '（纯文本无参考图）'}
核心验收要点：${c.expectedChecks}

以下是全部匿名候选输出：
${itemsText}`;

  const res = await fetch(judge.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${judge.key}` },
    body: JSON.stringify({
      model: judge.model,
      temperature: 0.1,
      max_tokens: 1800,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: user },
      ],
      ...(judge.extra || {}),
    }),
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw new Error(`裁判 ${judge.name} HTTP ${res.status}`);
  const d = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const raw = (d.choices?.[0]?.message?.content || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const parsed = JSON.parse(raw) as { scores?: Array<{ alias: string; faithfulness: number; visual: number; format: number; edge: number; total: number; comment: string }> };
  const mapped: Record<string, { total: number; faithfulness: number; visual: number; format: number; edge: number; comment: string }> = {};
  for (const s of parsed.scores || []) {
    const modelId = aliasToModel.get(s.alias);
    if (!modelId) continue;
    const total = Number(s.total) || Number(s.faithfulness || 0) + Number(s.visual || 0) + Number(s.format || 0) + Number(s.edge || 0);
    mapped[modelId] = {
      total,
      faithfulness: Number(s.faithfulness) || 0,
      visual: Number(s.visual) || 0,
      format: Number(s.format) || 0,
      edge: Number(s.edge) || 0,
      comment: String(s.comment || '').slice(0, 60),
    };
  }
  return mapped;
}

function percentile(arr: number[], p: number): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil(p * s.length) - 1)];
}

async function main() {
  const startedAt = new Date().toISOString();
  console.log('🚀 启动提示词强化 9 模型 × 10 场景零侵入实测...');

  const adminHeaders = await getAdminHeaders();

  // 1. 只读拉取当前系统真实生效的提示词版本与五大场景规则
  const pvData = (await (await fetch(`${BASE_URL}/api/admin/prompt-versions`, { headers: adminHeaders })).json()) as {
    active_version: number;
    versions: Array<{ version: number; body: string; note: string }>;
  };
  const scenesData = (await (await fetch(`${BASE_URL}/api/admin/scenes`, { headers: adminHeaders })).json()) as {
    scenes: Array<{ id: string; name: string; rules: string; enabled: number }>;
  };
  const activePromptObj = pvData.versions.find((v) => v.version === pvData.active_version)!;
  const sceneMap = new Map(scenesData.scenes.map((s) => [s.id, s]));
  console.log(`✅ 已读取系统生效提示词 V${activePromptObj.version}（${activePromptObj.note}），场景数：${scenesData.scenes.length}`);

  // 2. 预加载真图 base64 & 通过当前系统真实意图引擎获取 10 条样本的路由结果 + 非看图模型的视觉描述
  const caseContextCache = new Map<
    string,
    {
      dataUrl?: string;
      intent: Record<string, unknown>;
      intentMs: number;
      routedSceneId: string | null;
      visionDesc?: { text: string; ms: number };
    }
  >();

  for (const c of CASES) {
    const dataUrl = c.imageFile ? imageFileToDataUrl(c.imageFile) : undefined;
    const context: Record<string, unknown> = {};
    if (c.entry) context.entry = c.entry;
    if (dataUrl) context.reference_images = [dataUrl];

    const intentRes = await fetch(`${BASE_URL}/api/admin/intent`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ op: 'test_input', text: c.text, context }),
    });
    const intentPayload = (await intentRes.json()) as { intent: Record<string, unknown> };
    const intent = intentPayload.intent || {};
    const routedSceneId = (intent.routed_scene_id as string | null) || null;
    let visionDesc: { text: string; ms: number } | undefined;
    if (dataUrl) {
      visionDesc = await describeImageForTextModel(dataUrl, c.text);
    }
    caseContextCache.set(c.id, {
      dataUrl,
      intent,
      intentMs: Number(intent.latency_ms) || 0,
      routedSceneId,
      visionDesc,
    });
    console.log(`  [预处理 ${c.id}] 豆包意图=${intent.action_label || '?'} -> 场景=${routedSceneId || '默认'} (${intent.latency_ms}ms)${visionDesc ? ` | 辅助识图=${visionDesc.ms}ms` : ''}`);
  }

  // 3. 并发执行 9 款模型 × 10 条样本（按模型并发跑，每模型内部顺序执行以测稳态热连接延迟！）
  const resultsByCase: Record<string, Record<string, RunOutcome>> = {};
  for (const c of CASES) resultsByCase[c.id] = {};

  await Promise.all(
    MODELS.map(async (spec) => {
      console.log(`▶ 开始实测模型: ${spec.model} [${spec.channel}]`);
      for (const c of CASES) {
        const ctxCache = caseContextCache.get(c.id)!;
        const rawContext: Record<string, unknown> = {};
        if (c.entry) rawContext.entry = c.entry;
        if (ctxCache.dataUrl) rawContext.reference_images = [ctxCache.dataUrl];
        const parsedInput = parseEnhanceInput({ text: c.text, context: rawContext });

        if (spec.group === 'system_live') {
          // A 组：100% 走当前线上系统接口 /api/admin/playground
          try {
            const res = await fetch(`${BASE_URL}/api/admin/playground`, {
              method: 'POST',
              headers: adminHeaders,
              body: JSON.stringify({
                text: c.text,
                context: rawContext,
                model_id: spec.systemModelId,
                prompt_version: activePromptObj.version,
                kind: 'playground',
              }),
              signal: AbortSignal.timeout(45000),
            });
            const payload = (await res.json()) as {
              result?: EnhancementResult;
              metrics?: {
                total_ms: number;
                upstream_ms: number;
                intent_ms: number;
                vision_ms: number;
                attempts: number;
                input_tokens: number | null;
                output_tokens: number | null;
              };
              error?: { message?: string };
            };
            if (!res.ok || !payload.result) {
              throw new Error(payload.error?.message || `HTTP ${res.status}`);
            }
            const checks = evaluateObjectiveChecks(c, parsedInput, payload.result);
            resultsByCase[c.id][spec.id] = {
              ok: true,
              prompt: payload.result.prompt,
              negative_prompt: payload.result.negative_prompt,
              intent_category: payload.result.intent_category,
              assumptions: payload.result.assumptions || [],
              attempts: payload.metrics?.attempts || 1,
              total_ms: payload.metrics?.total_ms || 0,
              upstream_ms: payload.metrics?.upstream_ms || 0,
              intent_ms: payload.metrics?.intent_ms || 0,
              vision_ms: payload.metrics?.vision_ms || 0,
              input_tokens: payload.metrics?.input_tokens ?? null,
              output_tokens: payload.metrics?.output_tokens ?? null,
              prompt_chars: payload.result.prompt.length,
              checks,
            };
            console.log(`  ✓ ${spec.model} | ${c.id} | ${payload.metrics?.upstream_ms}ms (总${payload.metrics?.total_ms}ms) | 合规=${checks.allChecksPass}`);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            resultsByCase[c.id][spec.id] = {
              ok: false,
              error: msg,
              prompt: '',
              negative_prompt: '',
              intent_category: '',
              assumptions: [],
              attempts: 1,
              total_ms: 0,
              upstream_ms: 0,
              intent_ms: ctxCache.intentMs,
              vision_ms: 0,
              input_tokens: null,
              output_tokens: null,
              prompt_chars: 0,
            };
            console.log(`  ✗ ${spec.model} | ${c.id} | 失败: ${msg}`);
          }
        } else {
          // B 组：离线完全同口径（相同 V5 提示词 + 相同场景附加规则 + 相同豆包意图提示 + 相同一次重试 + 相同分段格式化与约束校验）
          const routedScene = ctxCache.routedSceneId ? sceneMap.get(ctxCache.routedSceneId) : undefined;
          const sceneSuffix = routedScene
            ? `\n\n当前使用场景：${routedScene.name}（${routedScene.id}）。${routedScene.rules.trim() ? `\n场景附加规则：\n${routedScene.rules.trim()}` : ''}`
            : '';
          const systemPrompt = activePromptObj.body + sceneSuffix;
          const intentHints: Record<string, string | boolean> = {
            action: String(ctxCache.intent.action || 'text_to_image'),
            action_label: String(ctxCache.intent.action_label || '全新文生图'),
            wants_rendered_text: Boolean(ctxCache.intent.wants_rendered_text),
            has_exclusions: Boolean(ctxCache.intent.has_exclusions),
          };
          if (ctxCache.routedSceneId) intentHints.routed_scene = ctxCache.routedSceneId;
          const catObj = ctxCache.intent.category as { value?: string } | null | undefined;
          if (catObj?.value) intentHints.category = catObj.value;

          const directImages = spec.nativeVision && ctxCache.dataUrl ? [ctxCache.dataUrl] : undefined;
          const visionMs = !spec.nativeVision && ctxCache.visionDesc ? ctxCache.visionDesc.ms : 0;
          const modelInput = textOnlyInput(parsedInput, !spec.nativeVision && ctxCache.visionDesc ? ctxCache.visionDesc.text : undefined);
          const userMessage = buildUserMessage(modelInput, undefined, intentHints);

          let retryInst = '';
          let attempts = 0;
          let upstreamMs = 0;
          let inTok: number | null = null;
          let outTok: number | null = null;
          let finalEnhanced: EnhancementResult | null = null;
          let errMsg = '';

          for (let attempt = 0; attempt < 2; attempt++) {
            attempts++;
            try {
              const out = await callCandidateDirect(spec, systemPrompt + retryInst, userMessage, directImages);
              upstreamMs += out.upstreamMs;
              if (out.inputTokens !== null) inTok = (inTok || 0) + out.inputTokens;
              if (out.outputTokens !== null) outTok = (outTok || 0) + out.outputTokens;
              const parsed = parseModelOutput(out.content);
              const enhanced: EnhancementResult = {
                ...parsed,
                status: 'enhanced',
                can_generate: true,
                prompt: formatPromptSyntax(parsed.prompt, parsedInput),
              };
              const miss = missingConstraints(parsedInput, enhanced);
              if (miss.length && attempt === 0) {
                retryInst = `\n\n修正上一次输出：必须在 prompt 中保留这些明确要求并保持分段字段语法：${miss.join('、')}。仍只返回规定的 JSON 对象。`;
                continue;
              }
              finalEnhanced = enhanced;
              break;
            } catch (e) {
              errMsg = e instanceof Error ? e.message : String(e);
              if (attempt === 0 && /JSON|格式|长度|状态/.test(errMsg)) {
                retryInst = '\n\n修正上一次输出：必须返回完整且有效的 JSON 对象，包含所有必需字段，prompt 保持分段字段语法。';
                continue;
              }
              break;
            }
          }

          if (finalEnhanced) {
            const checks = evaluateObjectiveChecks(c, parsedInput, finalEnhanced);
            resultsByCase[c.id][spec.id] = {
              ok: true,
              prompt: finalEnhanced.prompt,
              negative_prompt: finalEnhanced.negative_prompt,
              intent_category: finalEnhanced.intent_category,
              assumptions: finalEnhanced.assumptions || [],
              attempts,
              total_ms: ctxCache.intentMs + visionMs + upstreamMs,
              upstream_ms: upstreamMs,
              intent_ms: ctxCache.intentMs,
              vision_ms: visionMs,
              input_tokens: inTok,
              output_tokens: outTok,
              prompt_chars: finalEnhanced.prompt.length,
              checks,
            };
            console.log(`  ✓ ${spec.model} | ${c.id} | ${upstreamMs}ms (总${ctxCache.intentMs + visionMs + upstreamMs}ms) | 合规=${checks.allChecksPass}`);
          } else {
            resultsByCase[c.id][spec.id] = {
              ok: false,
              error: errMsg,
              prompt: '',
              negative_prompt: '',
              intent_category: '',
              assumptions: [],
              attempts,
              total_ms: ctxCache.intentMs + visionMs + upstreamMs,
              upstream_ms: upstreamMs,
              intent_ms: ctxCache.intentMs,
              vision_ms: visionMs,
              input_tokens: inTok,
              output_tokens: outTok,
              prompt_chars: 0,
            };
            console.log(`  ✗ ${spec.model} | ${c.id} | 失败: ${errMsg}`);
          }
        }
      }
    }),
  );

  // 4. 跨厂商双裁判匿名盲评（Qwen 3.8 Max + GPT-6.2-Sol，各评全部 10 题，隐藏所有模型名并随机洗牌）
  console.log('\n⚖️ 启动跨厂商双裁判匿名盲评（Qwen 3.8 Max + GPT-6.2-Sol）...');
  const judges = [
    {
      keyName: 'qwenMax' as const,
      name: 'Qwen 3.8 Max',
      endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      key: process.env.DASHSCOPE_API_KEY?.trim() || '',
      model: 'qwen3.8-max',
      extra: { enable_thinking: false },
    },
    {
      keyName: 'gpt62' as const,
      name: 'GPT-6.2-Sol',
      endpoint: 'https://api.apiyi.com/v1/chat/completions',
      key: process.env.APIYI_API_KEY?.trim() || '',
      model: 'gpt-6.2-sol',
    },
  ];

  await Promise.all(
    CASES.map(async (c) => {
      const outputs = MODELS.map((m) => ({
        modelId: m.id,
        prompt: resultsByCase[c.id][m.id]?.prompt || '',
        negative_prompt: resultsByCase[c.id][m.id]?.negative_prompt || '',
        ok: Boolean(resultsByCase[c.id][m.id]?.ok),
      }));
      const [r1, r2] = await Promise.all(
        judges.map((j) =>
          blindJudgeCase(c, outputs, j).catch((e) => {
            console.error(`  ⚠ 裁判 ${j.name} 评测 ${c.id} 失败:`, e.message);
            return {} as Record<string, { total: number; faithfulness: number; visual: number; format: number; edge: number; comment: string }>;
          }),
        ),
      );
      for (const m of MODELS) {
        const row = resultsByCase[c.id][m.id];
        if (!row || !row.ok) continue;
        const s1 = r1[m.id];
        const s2 = r2[m.id];
        const validTotals = [s1?.total, s2?.total].filter((n): n is number => typeof n === 'number' && n > 0);
        row.judgeScores = {
          qwenMax: s1,
          gpt62: s2,
          avgScore: validTotals.length ? Number((validTotals.reduce((a, b) => a + b, 0) / validTotals.length).toFixed(1)) : 0,
        };
      }
      console.log(`  ⚖️ 完成 ${c.id} 双裁判盲评`);
    }),
  );

  // 5. 汇总每款模型核心指标
  const summaries = MODELS.map((m) => {
    const rows = CASES.map((c) => ({ c, r: resultsByCase[c.id][m.id] }));
    const okRows = rows.filter((x) => x.r.ok);
    const textRows = okRows.filter((x) => !x.c.imageFile);
    const imgRows = okRows.filter((x) => Boolean(x.c.imageFile));
    const passAll = okRows.filter((x) => x.r.checks?.allChecksPass);
    const firstTryPass = okRows.filter((x) => x.r.attempts === 1 && x.r.checks?.allChecksPass);
    const upMsList = okRows.map((x) => x.r.upstream_ms);
    const textUpMsList = textRows.map((x) => x.r.upstream_ms);
    const imgUpMsList = imgRows.map((x) => x.r.upstream_ms + x.r.vision_ms);
    const totalMsList = okRows.map((x) => x.r.total_ms);

    const avgInTok = okRows.length
      ? Math.round(okRows.reduce((s, x) => s + (x.r.input_tokens || 900), 0) / okRows.length)
      : 0;
    const avgOutTok = okRows.length
      ? Math.round(okRows.reduce((s, x) => s + (x.r.output_tokens || 320), 0) / okRows.length)
      : 0;
    const costPer10k = Number((((avgInTok * m.inputCnyPer1M + avgOutTok * m.outputCnyPer1M) / 1_000_000) * 10000).toFixed(2));

    const blindScores = okRows.map((x) => x.r.judgeScores?.avgScore || 0).filter((v) => v > 0);
    const avgBlindScore = blindScores.length ? Number((blindScores.reduce((a, b) => a + b, 0) / blindScores.length).toFixed(1)) : 0;
    const avgChars = okRows.length ? Math.round(okRows.reduce((s, x) => s + x.r.prompt_chars, 0) / okRows.length) : 0;

    return {
      ...m,
      totalCases: CASES.length,
      successCount: okRows.length,
      successRate: Number(((okRows.length / CASES.length) * 100).toFixed(1)),
      passCount: passAll.length,
      passRate: Number(((passAll.length / CASES.length) * 100).toFixed(1)),
      firstTryPassCount: firstTryPass.length,
      firstTryPassRate: Number(((firstTryPass.length / CASES.length) * 100).toFixed(1)),
      avgUpstreamMs: upMsList.length ? Math.round(upMsList.reduce((a, b) => a + b, 0) / upMsList.length) : 0,
      p50UpstreamMs: percentile(upMsList, 0.5),
      p95UpstreamMs: percentile(upMsList, 0.95),
      textAvgUpstreamMs: textUpMsList.length ? Math.round(textUpMsList.reduce((a, b) => a + b, 0) / textUpMsList.length) : 0,
      imgAvgGenMs: imgUpMsList.length ? Math.round(imgUpMsList.reduce((a, b) => a + b, 0) / imgUpMsList.length) : 0,
      avgTotalMs: totalMsList.length ? Math.round(totalMsList.reduce((a, b) => a + b, 0) / totalMsList.length) : 0,
      avgInputTokens: avgInTok,
      avgOutputTokens: avgOutTok,
      avgChars,
      costPer10kCny: costPer10k,
      avgBlindScore,
    };
  });

  const report = {
    generatedAt: new Date().toISOString(),
    startedAt,
    promptVersion: activePromptObj.version,
    promptNote: activePromptObj.note,
    totalCases: CASES.length,
    modelsCount: MODELS.length,
    summaries,
    cases: CASES.map((c) => ({
      ...c,
      routedSceneId: caseContextCache.get(c.id)?.routedSceneId || null,
      intentAction: caseContextCache.get(c.id)?.intent.action_label || null,
      intentMs: caseContextCache.get(c.id)?.intentMs || 0,
    })),
    resultsByCase,
  };

  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2), 'utf8');
  console.log(`\n✅ 实测完成！原始数据已写入：${OUT_JSON}`);
  console.table(
    summaries.map((s) => ({
      模型: s.model,
      来源: s.group === 'system_live' ? '系统在线' : '新调研',
      成功: `${s.successCount}/${s.totalCases}`,
      硬指标通过: `${s.passCount}/${s.totalCases}`,
      双裁判盲评分: s.avgBlindScore,
      纯生成均耗ms: s.avgUpstreamMs,
      纯生成P95ms: s.p95UpstreamMs,
      端到端均耗ms: s.avgTotalMs,
      万次估算成本元: s.costPer10kCny,
    })),
  );
}

main().catch((e) => {
  console.error('❌ 评测脚本异常:', e);
  process.exit(1);
});
