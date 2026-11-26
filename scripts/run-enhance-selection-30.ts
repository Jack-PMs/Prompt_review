/**
 * 提示词强化模型「四维正式选型」实测脚本（5 款胜出模型 × 30 条全场景黄金样本 = 150 次真实调用）
 *
 * 严格约束：
 * 1. 零修改当前线上系统代码、数据库配置与 PM2 进程；
 * 2. 严禁使用 OpenAI 官方 Key 或 Gemini 官方 Key，全走已授权中转/云渠道；
 * 3. 四维全口径实测：效果（Qwen 3.8 Max + GPT-6.2-Sol 跨厂商双裁判盲评）+ 稳定性/成功率 + 响应速度（纯文本/带图/P95）+ 实测 Token 成本。
 */

import fs from 'node:fs';
import path from 'node:path';
import { buildUserMessage } from '../src/server/prompt';
import { formatPromptSyntax, isPromptSyntax } from '../src/server/prompt-syntax';
import { missingConstraints, parseEnhanceInput, parseModelOutput, textOnlyInput } from '../src/server/validation';
import type { EnhanceInput, EnhancementResult } from '../src/server/types';

// 只读加载 .env
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
const OUT_JSON = path.resolve(process.cwd(), 'data/enhance-model-selection-30cases.json');

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
  /** RMB per 1M tokens (input / output) */
  inputCnyPer1M: number;
  outputCnyPer1M: number;
  priceNote: string;
  extraBody?: Record<string, unknown>;
  roleNote: string;
}

export const MODELS: ModelSpec[] = [
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
    priceNote: '百炼直连参考 ¥0.30 / ¥1.80',
    roleNote: '当前系统线上默认主模型 · 原生看图 · 极致低价',
  },
  {
    id: 'new-qwen3.7-plus',
    model: 'qwen3.7-plus',
    displayName: 'Qwen 3.7 Plus',
    vendor: '阿里通义',
    channel: '阿里云百炼直连（新调研）',
    group: 'survey_candidate',
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    keyEnv: 'DASHSCOPE_API_KEY',
    nativeVision: true,
    inputCnyPer1M: 4.35,
    outputCnyPer1M: 17.40,
    priceNote: '公开价参考 $0.60 / $2.40 (¥4.35 / ¥17.40)',
    extraBody: { enable_thinking: false },
    roleNote: '通义中阶主力原生多模态 · 兼顾高文笔与直连速度',
  },
  {
    id: 'new-deepseek-v4-vision',
    model: 'deepseek/deepseek-v4-flash-vision-exp',
    displayName: 'DeepSeek V4 Flash Vision',
    vendor: 'DeepSeek',
    channel: 'RunningHub（新调研）',
    group: 'survey_candidate',
    endpoint: 'https://llm.runninghub.cn/v1/chat/completions',
    keyEnv: 'RUNNINGHUB_API_KEY',
    nativeVision: true,
    inputCnyPer1M: 3.19,
    outputCnyPer1M: 9.57,
    priceNote: '公开价参考 $0.44 / $1.32 (¥3.19 / ¥9.57)',
    extraBody: { thinking: { type: 'disabled' } },
    roleNote: 'DeepSeek 原生多模态看图版 · 补齐纯文本版看图短板',
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
    nativeVision: true,
    inputCnyPer1M: 0.80,
    outputCnyPer1M: 2.00,
    priceNote: '火山/同档参考 ¥0.80 / ¥2.00',
    extraBody: { thinking: { type: 'disabled' } },
    roleNote: '与已选意图模型同源 · 原生多模态看图 · 超低价',
  },
  {
    id: 'new-glm-5v-turbo',
    model: 'glm/glm-5v-turbo',
    displayName: 'GLM-5V Turbo',
    vendor: '智谱 AI',
    channel: 'RunningHub（新调研）',
    group: 'survey_candidate',
    endpoint: 'https://llm.runninghub.cn/v1/chat/completions',
    keyEnv: 'RUNNINGHUB_API_KEY',
    nativeVision: true,
    inputCnyPer1M: 1.50,
    outputCnyPer1M: 4.50,
    priceNote: '智谱轻量多模态同档参考 ¥1.50 / ¥4.50',
    extraBody: { thinking: { type: 'disabled' } },
    roleNote: '智谱最新原生视觉极速模型 · 实测 2s 级看图响应',
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
    inputCnyPer1M: 2.17,
    outputCnyPer1M: 18.12,
    priceNote: '公开价参考 $0.30 / $2.50 (¥2.17 / ¥18.12)',
    roleNote: '当前系统线上异构备选 · 原生看图 · 稳定基线',
  },
];

export interface TestCase {
  id: string;
  group: '家纺标准商拍' | '文字引号与排除' | '花型无缝平铺' | '真人模特展示' | '边界泛化零拦截' | '三笙实拍参考图';
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
  // A. 家纺标准商拍（6条）
  {
    id: 'C01', group: '家纺标准商拍', title: '亚麻抱枕 + 双排除约束',
    text: '米色粗亚麻方形抱枕，摆放在北欧原木客厅沙发上，不要文字，不要人物',
    expectedChecks: '保留米色/亚麻/抱枕/沙发，排除项双写进[限制]与negative_prompt',
    mustIncludeAny: [['米色'], ['亚麻'], ['抱枕'], ['沙发']],
  },
  {
    id: 'C02', group: '家纺标准商拍', title: '100支长绒棉轻奢四件套',
    text: '100支长绒棉香槟金贡缎四件套，意式轻奢主卧大床，突出丝绸光泽与垂坠感',
    expectedChecks: '准确保留香槟金、贡缎/长绒棉材质与轻奢卧室光影',
    mustIncludeAny: [['香槟'], ['贡缎', '长绒棉', '纯棉'], ['四件套', '床品']],
  },
  {
    id: 'C03', group: '家纺标准商拍', title: '儿童房星空云朵全棉床品',
    text: '浅蓝色星空云朵印花纯棉儿童四件套，温馨北欧儿童房，柔和自然光',
    expectedChecks: '保留浅蓝/星空/云朵/纯棉/儿童房氛围',
    mustIncludeAny: [['星空'], ['云朵'], ['纯棉', '全棉'], ['四件套', '床品']],
  },
  {
    id: 'C04', group: '家纺标准商拍', title: '新中式苏绣牡丹真丝抱枕',
    text: '新中式暗红色苏绣牡丹真丝抱枕，摆放在江南木窗边太师椅上',
    expectedChecks: '保留暗红/苏绣/牡丹/真丝/抱枕/东方典雅氛围',
    mustIncludeAny: [['牡丹'], ['真丝', '桑蚕丝'], ['抱枕']],
  },
  {
    id: 'C05', group: '家纺标准商拍', title: '复古格纹羊毛盖毯 + 排除水印',
    text: '秋冬英伦千鸟格羊毛盖毯，搭在红棕色皮沙发扶手上，壁炉暖光，不要水印',
    expectedChecks: '保留千鸟格/羊毛/盖毯/红棕皮沙发，排除水印',
    mustIncludeAny: [['千鸟格'], ['羊毛'], ['盖毯', '毛毯'], ['沙发']],
  },
  {
    id: 'C06', group: '家纺标准商拍', title: '极简 Emoji 短词床单',
    text: '🌸床单',
    expectedChecks: '围绕樱花/花卉床单合理补全材质构图与光影，不跑偏不拒答',
    mustIncludeAny: [['床单'], ['樱花', '花', '粉']],
  },

  // B. 文字引号与排除（4条）
  {
    id: 'C07', group: '文字引号与排除', title: '混合引号 + 否定冲突（地狱级）',
    text: '奶油白“云朵”纯棉四件套，不要多余文字，但枕套右下角绣上“晚安”字样',
    expectedChecks: '“云朵”去引号，“晚安”保留引号，限制段写不要其他文字',
    mustIncludeAny: [['纯棉', '全棉', '长绒棉'], ['四件套', '床品'], ['晚安']],
    expectRenderedQuote: '“晚安”',
    forbidQuote: '“云朵”',
  },
  {
    id: 'C08', group: '文字引号与排除', title: '否定提及文字不加引号',
    text: '浅灰色雪尼尔遮光窗帘，落地窗阳光透入，不要显示“特价清仓”字样',
    expectedChecks: '特价清仓属于排除项，绝不能用中文引号圈出作为画面渲染文字',
    mustIncludeAny: [['窗帘'], ['雪尼尔']],
    forbidQuote: '“特价清仓”',
  },
  {
    id: 'C09', group: '文字引号与排除', title: '礼盒包装指定印字',
    text: '极简米白棉麻家纺礼盒摆在原木桌面上，盒盖正中烫金印上“三笙家居”',
    expectedChecks: '精准用中文引号保留“三笙家居”烫金字样，其余普通词不加引号',
    mustIncludeAny: [['礼盒'], ['三笙家居']],
    expectRenderedQuote: '“三笙家居”',
  },
  {
    id: 'C10', group: '文字引号与排除', title: '无引号口语要求写字 + 去人物',
    text: '粉色纯棉抱枕正面绣上好梦两个字，放床头，不要出现人物',
    expectedChecks: '自动给渲染文字加“好梦”引号，同时排除人物',
    mustIncludeAny: [['抱枕'], ['纯棉', '全棉'], ['好梦']],
    expectRenderedQuote: '“好梦”',
  },

  // C. 花型无缝平铺（4条）
  {
    id: 'C11', group: '花型无缝平铺', title: '法式蓝白小雏菊无缝印花',
    text: '法式田园蓝白小雏菊与藤蔓无缝循环平铺印花图案，用于全棉四件套面料设计',
    expectedChecks: '路由至花型排版，强调正交俯视无缝四方连续平面图案，禁画立体床铺',
    mustIncludeAny: [['雏菊'], ['平铺', '无缝', '连续', '俯视']],
  },
  {
    id: 'C12', group: '花型无缝平铺', title: '莫兰迪雾蓝水墨抽象纹样',
    text: '莫兰迪雾蓝与米白水墨抽象晕染无缝平铺花型，适合高端家纺面料印花',
    expectedChecks: '强调平面俯视无缝拼接与水彩晕染织物肌理，无透视家具',
    mustIncludeAny: [['水墨', '晕染'], ['平铺', '无缝', '连续', '俯视']],
  },
  {
    id: 'C13', group: '花型无缝平铺', title: '手绘水彩小恐龙儿童面料花型',
    text: '清新北欧手绘水彩绿色小恐龙和树叶四方连续无缝平铺图案，儿童纯棉被套花型',
    expectedChecks: '手绘水彩恐龙与树叶均匀循环平铺，平面设计稿视角',
    mustIncludeAny: [['恐龙'], ['平铺', '无缝', '连续', '俯视']],
  },
  {
    id: 'C14', group: '花型无缝平铺', title: '复古暗纹提花面料连续图案',
    text: '燕麦色欧式复古卷草暗纹提花无缝循环面料纹样，高清平面织物纹理',
    expectedChecks: '保留燕麦色/卷草/提花织物肌理与正交平面无缝重复',
    mustIncludeAny: [['提花', '卷草'], ['平铺', '无缝', '连续', '俯视', '平面']],
  },

  // D. 真人模特展示（3条）
  {
    id: 'C15', group: '真人模特展示', title: '香槟色真丝睡衣卧室床边',
    text: '年轻亚洲女模特身穿香槟色真丝睡衣坐在清晨阳光卧室床边',
    expectedChecks: '路由至真人模特，刻画自然体态表情与香槟真丝垂坠光泽',
    mustIncludeAny: [['模特', '女性'], ['香槟'], ['真丝', '桑蚕丝'], ['睡衣']],
  },
  {
    id: 'C16', group: '真人模特展示', title: '全棉格子家居服客厅端杯看书',
    text: '气质温柔女模特穿米白全棉格子长袖家居服，在明亮客厅沙发上端茶杯看书',
    expectedChecks: '突出家居服全棉格子肌理与自然放松的生活化互动',
    mustIncludeAny: [['模特', '女性'], ['格子'], ['家居服']],
  },
  {
    id: 'C17', group: '真人模特展示', title: '日系棉麻围裙厨房烘焙展示',
    text: '年轻女模特身穿浅绿色日系水洗棉麻围裙，在阳光厨房木桌旁整理刚烤好的面包',
    expectedChecks: '围裙款式质感完整醒目，人物姿态和厨房自然光和谐',
    mustIncludeAny: [['围裙'], ['棉麻']],
  },

  // E. 边界泛化零拦截（7条）
  {
    id: 'C18', group: '边界泛化零拦截', title: '情绪叠词「啊啊啊啊啊」',
    text: '啊啊啊啊啊',
    expectedChecks: '零拦截、绝不偷换抱枕，转化成极具情绪张力的艺术字/呐喊视觉画面',
    mustNotInclude: ['抱枕', '四件套'],
  },
  {
    id: 'C19', group: '边界泛化零拦截', title: '纯数字「111111111」',
    text: '111111111',
    expectedChecks: '零拦截、绝不偷换抱枕，将数字 111111111 作为立体艺术字/数字雕塑视觉主体',
    mustIncludeAny: [['111111111', '九个1', '9个1', '数字1']],
    mustNotInclude: ['抱枕', '四件套'],
  },
  {
    id: 'C20', group: '边界泛化零拦截', title: '无意义键盘乱打「asdfghjkl」',
    text: 'asdfghjkl',
    expectedChecks: '零拦截、绝不偷换抱枕，锚定原文字符做成现代视觉艺术排版或立体字效',
    mustIncludeAny: [['asdfghjkl', 'ASDFGHJKL']],
    mustNotInclude: ['抱枕', '四件套'],
  },
  {
    id: 'C21', group: '边界泛化零拦截', title: '情绪短词「好累」',
    text: '好累',
    expectedChecks: '提炼疲惫与卸下重担的情绪氛围，具象为富有电影感/生活感的治愈视觉画面',
    mustNotInclude: ['拒绝', '无法生成'],
  },
  {
    id: 'C22', group: '边界泛化零拦截', title: '抽象审美词「高级感」',
    text: '高级感',
    expectedChecks: '具象化为克制极简的材质光影与建筑/静物视觉美学，避免空洞堆砌形容词',
    mustNotInclude: ['拒绝', '无法生成'],
  },
  {
    id: 'C23', group: '边界泛化零拦截', title: '版权IP零拦截（皮卡丘+哆啦A梦）',
    text: '皮卡丘和哆啦A梦卡通图案儿童纯棉四件套，温馨儿童房，柔和自然光',
    expectedChecks: '零审核拦截，完整保留皮卡丘和哆啦A梦并正常扩写',
    mustIncludeAny: [['皮卡丘'], ['哆啦A梦'], ['四件套', '床品']],
  },
  {
    id: 'C24', group: '边界泛化零拦截', title: '版权IP零拦截（库洛米睡衣）',
    text: '库洛米粉色蝴蝶结印花纯棉睡衣套装，甜美少女卧室实拍',
    expectedChecks: '零审核拦截，完整保留库洛米和粉色蝴蝶结元素',
    mustIncludeAny: [['库洛米'], ['蝴蝶结'], ['睡衣']],
  },

  // F. 三笙实拍参考图（6条）
  {
    id: 'C25', group: '三笙实拍参考图', title: '实拍图换法式阳光卧室背景',
    text: '换个法式阳光卧室背景，保持产品花色不变',
    imageFile: 'data/image_benchmark_120/IMG-111.jpg',
    expectedChecks: '读出图中家纺产品并保持款式花色严格不变，重点刻画法式阳光卧室新环境',
    mustIncludeAny: [['法式'], ['卧室']],
  },
  {
    id: 'C26', group: '三笙实拍参考图', title: '实拍图同款高级现代场景重拍',
    text: '做一张同款高级现代卧室场景图',
    imageFile: 'data/image_benchmark_120/IMG-108.jpg',
    expectedChecks: '准确还原参考图产品核心外观与色系，融入高级现代卧室光影空间',
    mustIncludeAny: [['卧室']],
  },
  {
    id: 'C27', group: '三笙实拍参考图', title: '实拍图换原木温馨场景优化光影',
    text: '优化一下光影场景，换成温馨原木风卧室',
    imageFile: 'data/image_benchmark_120/IMG-110.jpg',
    expectedChecks: '保持参考图主体不变，自然融入原木风卧室与柔和光影',
    mustIncludeAny: [['原木'], ['卧室']],
  },
  {
    id: 'C28', group: '三笙实拍参考图', title: '实拍图局部编辑去文字水印',
    text: '把图片里的文字和水印全去掉，其余保持原样',
    imageFile: 'data/image_benchmark_120/IMG-112.jpg',
    expectedChecks: '路由 local-edit，精准简洁局部擦除指令，明确声明原图主体背景不变',
    mustIncludeAny: [['文字', '水印'], ['不变', '原样', '保留']],
  },
  {
    id: 'C29', group: '三笙实拍参考图', title: '实拍图局部擦除文字标签',
    text: '把上面的文字和标签全部擦除干净，不改变产品本身',
    imageFile: 'data/image_benchmark_120/IMG-109.jpg',
    expectedChecks: '精准擦除文字与标签并修补局部底层纹理，保持原图其余部分不变',
    mustIncludeAny: [['文字', '标签'], ['不变', '原样', '保留']],
  },
  {
    id: 'C30', group: '三笙实拍参考图', title: '实拍图提取纹理做无缝平铺花型',
    text: '提取图中花型纹理做成无缝循环平铺图案',
    imageFile: 'data/image_benchmark_120/IMG-106.jpg',
    expectedChecks: '结合图中花纹特征，转为正交俯视四方连续无缝平铺面料图案',
    mustIncludeAny: [['平铺', '无缝', '连续', '俯视']],
  },
];

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
    signal: AbortSignal.timeout(20000),
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
    response_format: { type: 'json_object' },
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

interface JudgeVerdict {
  total: number;
  faithfulness: number;
  visual: number;
  format: number;
  edge: number;
  comment: string;
}

interface RunOutcome {
  ok: boolean;
  error?: string;
  prompt: string;
  negative_prompt: string;
  intent_category: string;
  attempts: number;
  total_ms: number;
  upstream_ms: number;
  intent_ms: number;
  vision_ms: number;
  /** 强化阶段净耗时 = 纯生成 + 辅助识图（不含共用的意图识别耗时） */
  enhance_net_ms: number;
  input_tokens: number | null;
  output_tokens: number | null;
  prompt_chars: number;
  checks?: ReturnType<typeof evaluateObjectiveChecks>;
  judgeScores?: {
    qwenMax?: JudgeVerdict;
    gpt62?: JudgeVerdict;
    avgScore: number;
  };
}

const judgeSchema = {
  type: 'object',
  properties: {
    scores: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          alias: { type: 'string' },
          faithfulness: { type: 'number' },
          visual: { type: 'number' },
          format: { type: 'number' },
          edge: { type: 'number' },
          total: { type: 'number' },
          comment: { type: 'string' },
        },
        required: ['alias', 'faithfulness', 'visual', 'format', 'edge', 'total', 'comment'],
        additionalProperties: false,
      },
    },
  },
  required: ['scores'],
  additionalProperties: false,
};

async function blindJudgeCase(
  c: TestCase,
  outputs: Array<{ modelId: string; prompt: string; negative_prompt: string; ok: boolean }>,
  judge: { name: string; endpoint: string; key: string; model: string; useSchema?: boolean; extra?: Record<string, unknown> },
): Promise<Record<string, JudgeVerdict>> {
  const valid = outputs.filter((o) => o.ok && o.prompt);
  if (!valid.length) return {};
  const shuffled = [...valid].sort(() => Math.random() - 0.5);
  const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
  const letterToModel = new Map<string, string>();
  const itemsText = shuffled
    .map((item, idx) => {
      const letter = letters[idx];
      letterToModel.set(letter, item.modelId);
      return `### 候选${letter}\n${item.prompt}\n[negative_prompt]: ${item.negative_prompt || '（空）'}`;
    })
    .join('\n\n');

  const sys = `你是资深AI图像生成提示词评审专家。请对下方每一个匿名候选模型（alias 请填单字母如 "A"、"B"...）严格拉开差距打分（满分100分）：
- faithfulness（0-30分）：忠实保留主体/材质/颜色/花型/文字/排除约束，无偷换无拒答；
- visual（0-40分）：视觉画面具象、高级、光影构图材质清晰、生图可用度高；
- format（0-20分）：分段字段清晰精炼、引号精准（仅画面渲染文字加引号）、贴合场景要求（如平铺不画床、局部改图不重绘整图）；
- edge（0-10分）：边界输入（情绪词/纯数字/短词/版权IP）泛化自然度与精炼度。
comment 限 20 字内中文简评。只返回纯 JSON 对象：{"scores":[{"alias":"A","faithfulness":28,"visual":35,"format":18,"edge":9,"total":90,"comment":"..."}]}`;

  const user = `【测试题 ${c.id}｜${c.group}｜${c.title}】\n用户原始输入：${c.text}\n${c.imageFile ? '（附带三笙真实商品参考图）' : '（纯文本无参考图）'}\n验收要点：${c.expectedChecks}\n\n${itemsText}`;

  const body: Record<string, unknown> = {
    model: judge.model,
    temperature: 0.1,
    max_tokens: 1800,
    response_format: judge.useSchema
      ? { type: 'json_schema', json_schema: { name: 'blind_judge', strict: true, schema: judgeSchema } }
      : { type: 'json_object' },
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: user },
    ],
    ...(judge.extra || {}),
  };

  const res = await fetch(judge.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${judge.key}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw new Error(`${judge.name} HTTP ${res.status}`);
  const d = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const raw = (d.choices?.[0]?.message?.content || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const parsed = JSON.parse(raw) as { scores?: Array<{ alias: string; faithfulness: number; visual: number; format: number; edge: number; total: number; comment: string }> };
  const mapped: Record<string, JudgeVerdict> = {};
  for (const s of parsed.scores || []) {
    const mLetter = String(s.alias || '').toUpperCase().match(/[A-F]/)?.[0];
    const modelId = mLetter ? letterToModel.get(mLetter) : undefined;
    if (!modelId) continue;
    mapped[modelId] = {
      total: Number(s.total) || Number(s.faithfulness || 0) + Number(s.visual || 0) + Number(s.format || 0) + Number(s.edge || 0),
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

/** 速度评分（0-100）：综合平均净生成耗时(70%)与P95(30%) */
function calcSpeedScore(avgNetMs: number, p95NetMs: number): number {
  const sAvg = Math.max(15, Math.min(100, Math.round(100 - ((avgNetMs - 2500) / 7500) * 85)));
  const sP95 = Math.max(15, Math.min(100, Math.round(100 - ((p95NetMs - 4000) / 10000) * 85)));
  return Number((sAvg * 0.7 + sP95 * 0.3).toFixed(1));
}

/** 成本评分（0-100）：万次调用估算成本对数映射（¥8->100, ¥16->90, ¥50->71, ¥90->58, ¥250->35） */
function calcCostScore(costPer10kCny: number): number {
  if (costPer10kCny <= 10) return 100;
  const score = 100 - Math.log2(costPer10kCny / 10) * 14.5;
  return Number(Math.max(10, Math.min(100, score)).toFixed(1));
}

async function runWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let idx = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const current = items[idx++];
      await fn(current);
    }
  });
  await Promise.all(workers);
}

async function main() {
  const startedAt = new Date().toISOString();
  console.log('🚀 启动提示词强化 5 模型 × 30 场景四维正式选型实测...');

  const adminHeaders = await getAdminHeaders();
  const pvData = (await (await fetch(`${BASE_URL}/api/admin/prompt-versions`, { headers: adminHeaders })).json()) as {
    active_version: number;
    versions: Array<{ version: number; body: string; note: string }>;
  };
  const scenesData = (await (await fetch(`${BASE_URL}/api/admin/scenes`, { headers: adminHeaders })).json()) as {
    scenes: Array<{ id: string; name: string; rules: string; enabled: number }>;
  };
  const activePromptObj = pvData.versions.find((v) => v.version === pvData.active_version)!;
  const sceneMap = new Map(scenesData.scenes.map((s) => [s.id, s]));
  console.log(`✅ 系统生效提示词 V${activePromptObj.version}（${activePromptObj.note}），已读 ${scenesData.scenes.length} 个场景规则`);

  // 1. 预处理 30 条样本的豆包意图识别 + 6 张真图辅助识图描述（并发 5 提速）
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

  await runWithConcurrency(CASES, 5, async (c) => {
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
    const visionDesc = dataUrl ? await describeImageForTextModel(dataUrl, c.text) : undefined;
    caseContextCache.set(c.id, {
      dataUrl,
      intent,
      intentMs: Number(intent.latency_ms) || 0,
      routedSceneId,
      visionDesc,
    });
  });
  console.log(`✅ 完成 30 条样本意图路由预处理（含 6 张真图辅助描述）`);

  // 2. 5 款模型并发执行（每款模型内部并发 2，既保持稳态连接又在 ~2 分钟内完成全部 150 次调用）
  const resultsByCase: Record<string, Record<string, RunOutcome>> = {};
  for (const c of CASES) resultsByCase[c.id] = {};

  await Promise.all(
    MODELS.map(async (spec) => {
      let okCount = 0;
      let passCount = 0;
      await runWithConcurrency(CASES, 2, async (c) => {
        const ctxCache = caseContextCache.get(c.id)!;
        const rawContext: Record<string, unknown> = {};
        if (c.entry) rawContext.entry = c.entry;
        if (ctxCache.dataUrl) rawContext.reference_images = [ctxCache.dataUrl];
        const parsedInput = parseEnhanceInput({ text: c.text, context: rawContext });

        if (spec.group === 'system_live') {
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
            if (!res.ok || !payload.result) throw new Error(payload.error?.message || `HTTP ${res.status}`);
            const checks = evaluateObjectiveChecks(c, parsedInput, payload.result);
            const upMs = payload.metrics?.upstream_ms || 0;
            const visMs = payload.metrics?.vision_ms || 0;
            resultsByCase[c.id][spec.id] = {
              ok: true,
              prompt: payload.result.prompt,
              negative_prompt: payload.result.negative_prompt,
              intent_category: payload.result.intent_category,
              attempts: payload.metrics?.attempts || 1,
              total_ms: payload.metrics?.total_ms || 0,
              upstream_ms: upMs,
              intent_ms: payload.metrics?.intent_ms || 0,
              vision_ms: visMs,
              enhance_net_ms: upMs + visMs,
              input_tokens: payload.metrics?.input_tokens ?? null,
              output_tokens: payload.metrics?.output_tokens ?? null,
              prompt_chars: payload.result.prompt.length,
              checks,
            };
            okCount++;
            if (checks.allChecksPass) passCount++;
          } catch (e) {
            resultsByCase[c.id][spec.id] = {
              ok: false,
              error: e instanceof Error ? e.message : String(e),
              prompt: '',
              negative_prompt: '',
              intent_category: '',
              attempts: 1,
              total_ms: 0,
              upstream_ms: 0,
              intent_ms: ctxCache.intentMs,
              vision_ms: 0,
              enhance_net_ms: 0,
              input_tokens: null,
              output_tokens: null,
              prompt_chars: 0,
            };
          }
        } else {
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
              attempts,
              total_ms: ctxCache.intentMs + visionMs + upstreamMs,
              upstream_ms: upstreamMs,
              intent_ms: ctxCache.intentMs,
              vision_ms: visionMs,
              enhance_net_ms: upstreamMs + visionMs,
              input_tokens: inTok,
              output_tokens: outTok,
              prompt_chars: finalEnhanced.prompt.length,
              checks,
            };
            okCount++;
            if (checks.allChecksPass) passCount++;
          } else {
            resultsByCase[c.id][spec.id] = {
              ok: false,
              error: errMsg,
              prompt: '',
              negative_prompt: '',
              intent_category: '',
              attempts,
              total_ms: ctxCache.intentMs + visionMs + upstreamMs,
              upstream_ms: upstreamMs,
              intent_ms: ctxCache.intentMs,
              vision_ms: visionMs,
              enhance_net_ms: upstreamMs + visionMs,
              input_tokens: inTok,
              output_tokens: outTok,
              prompt_chars: 0,
            };
          }
        }
      });
      console.log(`✅ 模型完成：${spec.displayName} | 成功 ${okCount}/${CASES.length} | 硬指标全过 ${passCount}/${CASES.length}`);
    }),
  );

  // 3. 跨厂商双裁判匿名盲评（Qwen 3.8 Max + GPT-6.2-Sol，并发 5 批次）
  console.log('\n⚖️ 启动跨厂商双裁判匿名盲评（Qwen 3.8 Max + GPT-6.2-Sol，全部 30 题）...');
  const judges = [
    {
      name: 'Qwen 3.8 Max',
      endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      key: process.env.DASHSCOPE_API_KEY?.trim() || '',
      model: 'qwen3.8-max',
      useSchema: false,
      extra: { enable_thinking: false },
    },
    {
      name: 'GPT-6.2-Sol',
      endpoint: 'https://api.apiyi.com/v1/chat/completions',
      key: process.env.APIYI_API_KEY?.trim() || '',
      model: 'gpt-6.2-sol',
      useSchema: true,
    },
  ];

  let judgedCount = 0;
  await runWithConcurrency(CASES, 5, async (c) => {
    const outputs = MODELS.map((m) => ({
      modelId: m.id,
      prompt: resultsByCase[c.id][m.id]?.prompt || '',
      negative_prompt: resultsByCase[c.id][m.id]?.negative_prompt || '',
      ok: Boolean(resultsByCase[c.id][m.id]?.ok),
    }));
    const [r1, r2] = await Promise.all(
      judges.map((j) =>
        blindJudgeCase(c, outputs, j).catch((e) => {
          console.error(`  ⚠ 裁判 ${j.name} 评测 ${c.id} 异常:`, e.message);
          return {} as Record<string, JudgeVerdict>;
        }),
      ),
    );
    for (const m of MODELS) {
      const row = resultsByCase[c.id][m.id];
      if (!row?.ok) continue;
      const s1 = r1[m.id];
      const s2 = r2[m.id];
      const vals = [s1?.total, s2?.total].filter((n): n is number => typeof n === 'number' && n > 0);
      row.judgeScores = {
        qwenMax: s1,
        gpt62: s2,
        avgScore: vals.length ? Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1)) : 0,
      };
    }
    judgedCount++;
    if (judgedCount % 10 === 0 || judgedCount === CASES.length) {
      console.log(`  ⚖️ 盲评进度：${judgedCount}/${CASES.length}`);
    }
  });

  // 4. 汇总四维核心指标 + 均衡综合加权分（效果35% + 稳定性25% + 速度25% + 成本15%）
  const summaries = MODELS.map((m) => {
    const rows = CASES.map((c) => ({ c, r: resultsByCase[c.id][m.id] }));
    const okRows = rows.filter((x) => x.r.ok);
    const textRows = okRows.filter((x) => !x.c.imageFile);
    const imgRows = okRows.filter((x) => Boolean(x.c.imageFile));
    const passAll = okRows.filter((x) => x.r.checks?.allChecksPass);
    const firstTryPass = okRows.filter((x) => x.r.attempts === 1 && x.r.checks?.allChecksPass);

    const netMsAll = okRows.map((x) => x.r.enhance_net_ms);
    const textUpMs = textRows.map((x) => x.r.upstream_ms);
    const imgNetMs = imgRows.map((x) => x.r.enhance_net_ms);
    const totalMsAll = okRows.map((x) => x.r.total_ms);

    const avgNetMs = netMsAll.length ? Math.round(netMsAll.reduce((a, b) => a + b, 0) / netMsAll.length) : 0;
    const p50NetMs = percentile(netMsAll, 0.5);
    const p95NetMs = percentile(netMsAll, 0.95);
    const textAvgMs = textUpMs.length ? Math.round(textUpMs.reduce((a, b) => a + b, 0) / textUpMs.length) : 0;
    const imgAvgMs = imgNetMs.length ? Math.round(imgNetMs.reduce((a, b) => a + b, 0) / imgNetMs.length) : 0;
    const avgTotalMs = totalMsAll.length ? Math.round(totalMsAll.reduce((a, b) => a + b, 0) / totalMsAll.length) : 0;

    // 计算真实成本：对于非原生看图模型，带图场景还包含 20% 比例的辅助识图费（qwen3.8-flash 约 ¥0.0005/次，即万次 ¥1.0）
    const avgInTok = okRows.length ? Math.round(okRows.reduce((s, x) => s + (x.r.input_tokens || 950), 0) / okRows.length) : 0;
    const avgOutTok = okRows.length ? Math.round(okRows.reduce((s, x) => s + (x.r.output_tokens || 320), 0) / okRows.length) : 0;
    const auxVisionCost10k = m.nativeVision ? 0 : 1.2;
    const costPer10kCny = Number((((avgInTok * m.inputCnyPer1M + avgOutTok * m.outputCnyPer1M) / 1_000_000) * 10000 + auxVisionCost10k).toFixed(2));

    const blindScores = okRows.map((x) => x.r.judgeScores?.avgScore || 0).filter((v) => v > 0);
    const qScores = okRows.map((x) => x.r.judgeScores?.qwenMax?.total || 0).filter((v) => v > 0);
    const gScores = okRows.map((x) => x.r.judgeScores?.gpt62?.total || 0).filter((v) => v > 0);
    const textBlind = textRows.map((x) => x.r.judgeScores?.avgScore || 0).filter((v) => v > 0);
    const imgBlind = imgRows.map((x) => x.r.judgeScores?.avgScore || 0).filter((v) => v > 0);

    const avgBlindScore = blindScores.length ? Number((blindScores.reduce((a, b) => a + b, 0) / blindScores.length).toFixed(1)) : 0;
    const qwenJudgeAvg = qScores.length ? Number((qScores.reduce((a, b) => a + b, 0) / qScores.length).toFixed(1)) : 0;
    const gptJudgeAvg = gScores.length ? Number((gScores.reduce((a, b) => a + b, 0) / gScores.length).toFixed(1)) : 0;
    const textBlindAvg = textBlind.length ? Number((textBlind.reduce((a, b) => a + b, 0) / textBlind.length).toFixed(1)) : 0;
    const imgBlindAvg = imgBlind.length ? Number((imgBlind.reduce((a, b) => a + b, 0) / imgBlind.length).toFixed(1)) : 0;

    const successRate = Number(((okRows.length / CASES.length) * 100).toFixed(1));
    const passRate = Number(((passAll.length / CASES.length) * 100).toFixed(1));
    const firstTryPassRate = Number(((firstTryPass.length / CASES.length) * 100).toFixed(1));

    // 四维分项得分（0-100）
    const qualityScore = avgBlindScore;
    const reliabilityScore = Number((successRate * 0.5 + passRate * 0.5).toFixed(1));
    const speedScore = calcSpeedScore(avgNetMs, p95NetMs);
    const costScore = calcCostScore(costPer10kCny);
    const compositeScore = Number((qualityScore * 0.35 + reliabilityScore * 0.25 + speedScore * 0.25 + costScore * 0.15).toFixed(1));

    return {
      ...m,
      totalCases: CASES.length,
      successCount: okRows.length,
      successRate,
      passCount: passAll.length,
      passRate,
      firstTryPassCount: firstTryPass.length,
      firstTryPassRate,
      avgNetMs,
      p50NetMs,
      p95NetMs,
      textAvgMs,
      imgAvgMs,
      avgTotalMs,
      avgInputTokens: avgInTok,
      avgOutputTokens: avgOutTok,
      avgChars: okRows.length ? Math.round(okRows.reduce((s, x) => s + x.r.prompt_chars, 0) / okRows.length) : 0,
      costPer10kCny,
      avgBlindScore,
      qwenJudgeAvg,
      gptJudgeAvg,
      textBlindAvg,
      imgBlindAvg,
      dimensions: { qualityScore, reliabilityScore, speedScore, costScore, compositeScore },
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
  console.log(`\n✅ 30 场景四维正式实测完成！原始数据：${OUT_JSON}`);
  console.table(
    [...summaries]
      .sort((a, b) => b.dimensions.compositeScore - a.dimensions.compositeScore)
      .map((s) => ({
        模型: s.displayName,
        综合分: s.dimensions.compositeScore,
        效果分: s.dimensions.qualityScore,
        稳定分: s.dimensions.reliabilityScore,
        速度分: s.dimensions.speedScore,
        成本分: s.dimensions.costScore,
        成功_合规: `${s.successCount}/${s.passCount}`,
        纯文均耗ms: s.textAvgMs,
        带图均耗ms: s.imgAvgMs,
        P95ms: s.p95NetMs,
        万次成本元: s.costPer10kCny,
      })),
  );
}

main().catch((e) => {
  console.error('❌ 30 场景评测异常:', e);
  process.exit(1);
});
