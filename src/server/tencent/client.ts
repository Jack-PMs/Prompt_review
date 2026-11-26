import { createHash, createHmac } from 'node:crypto';
import type { DecisionQuestion, NormalizedResponse } from '../decision/client';

/** 腾讯云数据万象 CI 内容审核配置，全部从服务端环境变量读取 */
export interface TencentCiConfig {
  secretId: string;
  secretKey: string;
  bucket: string;
  /** 可选的对象目录前缀（例如 `temp-1375644169/renjp` 中的 `renjp`） */
  prefix: string;
  region: string;
  textBizType: string;
  imageBizType: string;
}

/** 单个风险维度的审核结果（对应 PornInfo / PoliticsInfo / TerrorismInfo / IllegalInfo / AbuseInfo / AdsInfo） */
export interface TencentCiCategoryInfo {
  category: 'Porn' | 'Politics' | 'Terrorism' | 'Illegal' | 'Abuse' | 'Ads';
  hitFlag: 0 | 1 | 2;
  score: number;
  label: string;
  subLabel: string;
  keywords: string[];
}

/** 腾讯云数据万象 CI 单次审核结果（文本同步审核 / 单张图片同步审核通用结构） */
export interface TencentCiAuditResult {
  modality: 'text' | 'image';
  jobId: string;
  requestId: string;
  state: string;
  /** 综合处置建议：pass(0 正常) / block(1 违规) / review(2 疑似复核) */
  suggestion: 'pass' | 'review' | 'block';
  /** 原始 Result 数值：0 正常 / 1 违规 / 2 疑似 */
  resultCode: 0 | 1 | 2;
  label: string;
  subLabel: string;
  score: number;
  keywords: string[];
  categories: TencentCiCategoryInfo[];
  latencyMs: number;
  rawXml: string;
}

/** 腾讯云数据万象 CI 审核错误类型，区分权限不足、桶未开通审核与临时网络错误 */
export class TencentReviewError extends Error {
  constructor(
    public code: string,
    message: string,
    public transient = false,
    public status: number | null = null,
    public rawResponse: string | null = null,
  ) {
    super(message);
  }
}

/** 解析存储桶与目录前缀，例如 `temp-1375644169/renjp` -> `{ bucket: 'temp-1375644169', prefix: 'renjp' }` */
export function parseTencentCiBucketAndPrefix(raw: string): { bucket: string; prefix: string } {
  const trimmed = raw.trim().replace(/^https?:\/\//i, '');
  const [firstSegment = '', ...rest] = trimmed.split('/');
  const bucket = firstSegment
    .replace(/\.cos\.[a-z0-9-]+\.myqcloud\.com$/i, '')
    .replace(/\.ci\.[a-z0-9-]+\.myqcloud\.com$/i, '');
  const prefix = rest.filter(Boolean).join('/');
  return { bucket, prefix };
}

/** 规范化 COS 存储桶名，自动兼容 `temp-1375644169/renjp` 这种带目录前缀的写法 */
export function normalizeTencentCiBucket(raw: string): string {
  return parseTencentCiBucketAndPrefix(raw).bucket;
}

/** 读取腾讯云数据万象 CI 配置 */
export function getTencentCiConfig(): TencentCiConfig {
  const secretId = process.env.TENCENT_SECRET_ID?.trim() || '';
  const secretKey = process.env.TENCENT_SECRET_KEY?.trim() || '';
  const { bucket, prefix } = parseTencentCiBucketAndPrefix(process.env.TENCENT_CI_BUCKET || process.env.COS_BUCKET || '');
  const region = (process.env.TENCENT_CI_REGION || process.env.COS_REGION || '').trim();
  const textBizType = process.env.TENCENT_CI_TEXT_BIZ_TYPE?.trim() || '';
  const imageBizType = process.env.TENCENT_CI_IMAGE_BIZ_TYPE?.trim() || '';
  return { secretId, secretKey, bucket, prefix, region, textBizType, imageBizType };
}

/** 判断腾讯云数据万象 CI 审核所需配置是否完整 */
export function isTencentCiConfigured(): boolean {
  const cfg = getTencentCiConfig();
  return Boolean(cfg.secretId && cfg.secretKey && cfg.bucket && cfg.region);
}

/** 构造数据万象 CI 域名（`<BucketName-APPID>.ci.<Region>.myqcloud.com`） */
export function getTencentCiHost(cfg = getTencentCiConfig()): string | null {
  if (!cfg.bucket || !cfg.region) return null;
  return `${cfg.bucket}.ci.${cfg.region}.myqcloud.com`;
}

/** 构造腾讯云 COS / 数据万象 CI 请求签名（q-sign-algorithm=sha1） */
export function buildTencentCosAuthorization(params: {
  secretId: string;
  secretKey: string;
  method: string;
  path: string;
  host: string;
  startTime: number;
  expireTime: number;
}): string {
  const hostLower = params.host.toLowerCase();
  const keyTime = `${params.startTime};${params.expireTime}`;
  const signKey = createHmac('sha1', params.secretKey).update(keyTime).digest('hex');
  const httpString = `${params.method.toLowerCase()}\n${params.path}\n\nhost=${encodeURIComponent(hostLower)}\n`;
  const sha1Http = createHash('sha1').update(httpString).digest('hex');
  const stringToSign = `sha1\n${keyTime}\n${sha1Http}\n`;
  const signature = createHmac('sha1', signKey).update(stringToSign).digest('hex');
  return `q-sign-algorithm=sha1&q-ak=${params.secretId}&q-sign-time=${keyTime}&q-key-time=${keyTime}&q-header-list=host&q-url-param-list=&q-signature=${signature}`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function unescapeXml(value: string): string {
  return value
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

function extractTag(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'));
  return match ? unescapeXml(match[1].trim()) : '';
}

function extractAllTags(xml: string, tag: string): string[] {
  const regex = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'gi');
  const out: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml)) !== null) {
    out.push(match[1]);
  }
  return out;
}

function parseIntSafe(raw: string, fallback = 0): number {
  const num = Number(raw);
  return Number.isFinite(num) ? Math.round(num) : fallback;
}

function toHitFlag(raw: number): 0 | 1 | 2 {
  if (raw === 1) return 1;
  if (raw === 2) return 2;
  return 0;
}

function resultCodeToSuggestion(code: 0 | 1 | 2): 'pass' | 'review' | 'block' {
  if (code === 1) return 'block';
  if (code === 2) return 'review';
  return 'pass';
}

const CI_CATEGORY_TAGS: Array<{ tag: string; category: TencentCiCategoryInfo['category'] }> = [
  { tag: 'PornInfo', category: 'Porn' },
  { tag: 'PoliticsInfo', category: 'Politics' },
  { tag: 'TerrorismInfo', category: 'Terrorism' },
  { tag: 'IllegalInfo', category: 'Illegal' },
  { tag: 'AbuseInfo', category: 'Abuse' },
  { tag: 'AdsInfo', category: 'Ads' },
];

/** 解析数据万象 CI 单个 `<JobsDetail>` 片段（兼容文本同步审核与图片批量同步审核） */
export function parseTencentCiJobsDetail(
  detailXml: string,
  modality: 'text' | 'image',
  requestId: string,
  latencyMs: number,
  rawXml: string,
): TencentCiAuditResult {
  const jobId = extractTag(detailXml, 'JobId');
  const state = extractTag(detailXml, 'State') || 'Success';
  const errCode = extractTag(detailXml, 'Code');
  const errMsg = extractTag(detailXml, 'Message');
  if (state.toLowerCase() === 'failed' || (errCode && errCode !== '0' && errCode.toLowerCase() !== 'success')) {
    throw new TencentReviewError(
      errCode || 'TENCENT_CI_JOB_FAILED',
      `腾讯云数据万象审核任务失败（${errCode || state}）：${errMsg || '未知错误'}`,
      false,
      200,
      rawXml,
    );
  }

  // 解析各分类节点（汇总节点 + Section / ResultDetail 子节点，取最高风险分与全部命中词）
  const categories: TencentCiCategoryInfo[] = [];
  const allKeywords = new Set<string>();
  for (const { tag, category } of CI_CATEGORY_TAGS) {
    const blocks = extractAllTags(detailXml, tag);
    if (!blocks.length) continue;
    let bestHitFlag: 0 | 1 | 2 = 0;
    let bestScore = 0;
    let bestLabel = '';
    let bestSubLabel = '';
    const kwSet = new Set<string>();
    for (const block of blocks) {
      const hitFlag = toHitFlag(parseIntSafe(extractTag(block, 'HitFlag'), 0));
      const score = Math.max(0, Math.min(100, parseIntSafe(extractTag(block, 'Score'), 0)));
      const label = extractTag(block, 'Label') || extractTag(block, 'Category');
      const subLabel = extractTag(block, 'SubLabel');
      const kwRaw = extractTag(block, 'Keywords');
      if (kwRaw) {
        for (const kw of kwRaw.split(/[,，\n]/).map(s => s.trim()).filter(Boolean)) {
          kwSet.add(kw);
          allKeywords.add(kw);
        }
      }
      // HitFlag 优先级：1(违规) > 2(疑似) > 0(正常)
      const rank = (f: 0 | 1 | 2) => (f === 1 ? 2 : f === 2 ? 1 : 0);
      if (rank(hitFlag) > rank(bestHitFlag)) bestHitFlag = hitFlag;
      if (score >= bestScore) {
        bestScore = score;
        if (label) bestLabel = label;
        if (subLabel) bestSubLabel = subLabel;
      }
    }
    categories.push({
      category,
      hitFlag: bestHitFlag,
      score: bestScore,
      label: bestLabel,
      subLabel: bestSubLabel,
      keywords: [...kwSet],
    });
  }

  // 剥离各分类子节点与 Section/ResultDetail 后，再读取 JobsDetail 顶层字段，避免误抓 PornInfo 内的 Score/Label
  const topLevelXml = detailXml
    .replace(/<(?:PornInfo|PoliticsInfo|TerrorismInfo|IllegalInfo|AbuseInfo|AdsInfo|Section|ResultDetail)(?:\s[^>]*)?>[\s\S]*?<\/(?:PornInfo|PoliticsInfo|TerrorismInfo|IllegalInfo|AbuseInfo|AdsInfo|Section|ResultDetail)>/gi, '');

  const rawResultStr = extractTag(topLevelXml, 'Result');
  let resultCode: 0 | 1 | 2 = rawResultStr ? toHitFlag(parseIntSafe(rawResultStr, 0)) : 0;
  // 若 Result 节点缺省，根据分类 HitFlag 自动推导最高处置级别
  if (!rawResultStr) {
    if (categories.some(c => c.hitFlag === 1)) resultCode = 1;
    else if (categories.some(c => c.hitFlag === 2)) resultCode = 2;
  }

  const topCategory = [...categories].sort((a, b) => {
    const rank = (f: 0 | 1 | 2) => (f === 1 ? 2 : f === 2 ? 1 : 0);
    return rank(b.hitFlag) - rank(a.hitFlag) || b.score - a.score;
  })[0];

  const topScoreStr = extractTag(topLevelXml, 'Score');
  const parsedTopScore = topScoreStr ? Math.max(0, Math.min(100, parseIntSafe(topScoreStr, 0))) : 0;
  const score = Math.max(parsedTopScore, topCategory?.score ?? 0);
  const label = extractTag(topLevelXml, 'Label') || (resultCode === 0 ? 'Normal' : topCategory?.category || 'Normal');
  const subLabel = extractTag(topLevelXml, 'SubLabel') || topCategory?.subLabel || '';

  return {
    modality,
    jobId,
    requestId,
    state,
    suggestion: resultCodeToSuggestion(resultCode),
    resultCode,
    label,
    subLabel,
    score,
    keywords: [...allKeywords],
    categories,
    latencyMs,
    rawXml,
  };
}

/** 通用数据万象 CI XML API 调用 */
async function callTencentCiXml(params: {
  path: '/text/auditing' | '/image/auditing';
  xmlBody: string;
  signal?: AbortSignal;
}): Promise<{ status: number; rawXml: string; requestId: string; latencyMs: number }> {
  const cfg = getTencentCiConfig();
  if (!cfg.secretId || !cfg.secretKey) {
    throw new TencentReviewError('TENCENT_KEY_MISSING', '未配置 TENCENT_SECRET_ID 或 TENCENT_SECRET_KEY');
  }
  const host = getTencentCiHost(cfg);
  if (!host) {
    throw new TencentReviewError('TENCENT_CI_CONFIG_MISSING', '未配置数据万象存储桶 TENCENT_CI_BUCKET 或地域 TENCENT_CI_REGION');
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const auth = buildTencentCosAuthorization({
    secretId: cfg.secretId,
    secretKey: cfg.secretKey,
    method: 'POST',
    path: params.path,
    host,
    startTime: nowSec - 60,
    expireTime: nowSec + 600,
  });

  const started = performance.now();
  const res = await fetch(`https://${host}${params.path}`, {
    method: 'POST',
    headers: {
      Host: host,
      Authorization: auth,
      'Content-Type': 'application/xml; charset=utf-8',
    },
    body: params.xmlBody,
    signal: params.signal,
    cache: 'no-store',
  });
  const latencyMs = Math.round(performance.now() - started);
  const rawXml = await res.text();
  const requestId = extractTag(rawXml, 'RequestId') || res.headers.get('x-ci-request-id') || '';

  if (!res.ok || /<Error>/i.test(rawXml)) {
    const errCode = extractTag(rawXml, 'Code') || `HTTP_${res.status}`;
    const errMsg = extractTag(rawXml, 'Message') || `数据万象 CI 请求失败（HTTP ${res.status}）`;
    if (errCode === 'AccessDenied' || res.status === 401 || res.status === 403) {
      const actionHint = params.path === '/text/auditing' ? 'ci:CreateAuditingTextJob' : 'ci:CreateAuditingPictureJob';
      throw new TencentReviewError(
        'TENCENT_CI_UNAUTHORIZED',
        `腾讯云数据万象权限不足（${errCode}）：请在 CAM 为当前子账号授予 ${actionHint}（或绑定 QcloudCIFullAccess）并允许访问桶 ${cfg.bucket}（${cfg.region}）`,
        false,
        res.status,
        rawXml,
      );
    }
    if (errCode === 'AuditBucketUnBinded' || errMsg.includes('not activated')) {
      throw new TencentReviewError(
        'TENCENT_CI_NOT_ACTIVATED',
        `存储桶 ${cfg.bucket}（${cfg.region}）尚未在腾讯云数据万象控制台绑定并开启内容审核服务`,
        false,
        res.status,
        rawXml,
      );
    }
    const transient = res.status >= 500 || res.status === 429 || errCode.includes('InternalError') || errCode.includes('RequestLimitExceeded');
    throw new TencentReviewError(errCode, `腾讯云数据万象错误（${errCode}）：${errMsg}`, transient, res.status, rawXml);
  }

  return { status: res.status, rawXml, requestId, latencyMs };
}

/** 将长文本按 UTF-8 字符数切片（数据万象同步文本审核单次上限 10,000 字符） */
function splitTextChunks(text: string, maxChars = 9500): string[] {
  const chars = [...text];
  if (chars.length <= maxChars) return [text];
  const chunks: string[] = [];
  for (let i = 0; i < chars.length; i += maxChars) {
    chunks.push(chars.slice(i, i + maxChars).join(''));
  }
  return chunks;
}

/** 合并多段审核结果，按最高风险原则保留（绝不平均稀释风险） */
function mergeAuditResults(results: TencentCiAuditResult[], modality: 'text' | 'image'): TencentCiAuditResult {
  if (results.length === 1) return results[0];
  const rank = (code: 0 | 1 | 2) => (code === 1 ? 2 : code === 2 ? 1 : 0);
  let worst = results[0];
  const byCategory = new Map<TencentCiCategoryInfo['category'], TencentCiCategoryInfo>();
  const allKeywords = new Set<string>();
  let totalLatency = 0;

  for (const r of results) {
    totalLatency += r.latencyMs;
    if (rank(r.resultCode) > rank(worst.resultCode) || (rank(r.resultCode) === rank(worst.resultCode) && r.score > worst.score)) {
      worst = r;
    }
    for (const kw of r.keywords) allKeywords.add(kw);
    for (const cat of r.categories) {
      const prev = byCategory.get(cat.category);
      if (!prev) {
        byCategory.set(cat.category, { ...cat, keywords: [...cat.keywords] });
      } else {
        const mergedKw = new Set([...prev.keywords, ...cat.keywords]);
        byCategory.set(cat.category, {
          category: cat.category,
          hitFlag: rank(cat.hitFlag) > rank(prev.hitFlag) ? cat.hitFlag : prev.hitFlag,
          score: Math.max(prev.score, cat.score),
          label: cat.score >= prev.score && cat.label ? cat.label : prev.label,
          subLabel: cat.score >= prev.score && cat.subLabel ? cat.subLabel : prev.subLabel,
          keywords: [...mergedKw],
        });
      }
    }
  }

  return {
    modality,
    jobId: results.map(r => r.jobId).filter(Boolean).join(','),
    requestId: results.map(r => r.requestId).filter(Boolean).join(','),
    state: worst.state,
    suggestion: worst.suggestion,
    resultCode: worst.resultCode,
    label: worst.label,
    subLabel: worst.subLabel,
    score: worst.score,
    keywords: [...allKeywords],
    categories: [...byCategory.values()],
    latencyMs: totalLatency,
    rawXml: results.map(r => r.rawXml).join('\n'),
  };
}

/**
 * 调用腾讯云数据万象 CI 文本内容同步审核（POST /text/auditing）。
 * 超过 9500 字自动分片并按最高风险合并结果。
 */
export async function reviewTextWithTencentCi(
  text: string,
  options?: { bizType?: string; dataId?: string; signal?: AbortSignal },
): Promise<TencentCiAuditResult> {
  const cfg = getTencentCiConfig();
  const bizType = options?.bizType ?? cfg.textBizType;
  const chunks = splitTextChunks(text, 9500);
  const results: TencentCiAuditResult[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const contentBase64 = Buffer.from(chunks[i], 'utf8').toString('base64');
    const dataIdXml = options?.dataId ? `<DataId>${escapeXml(`${options.dataId}_${i + 1}`)}</DataId>` : '';
    const confXml = bizType ? `<Conf><BizType>${escapeXml(bizType)}</BizType></Conf>` : '';
    const xmlBody = `<Request><Input><Content>${contentBase64}</Content>${dataIdXml}</Input>${confXml}</Request>`;
    const { rawXml, requestId, latencyMs } = await callTencentCiXml({
      path: '/text/auditing',
      xmlBody,
      signal: options?.signal,
    });
    const detailXml = extractAllTags(rawXml, 'JobsDetail')[0] || rawXml;
    results.push(parseTencentCiJobsDetail(detailXml, 'text', requestId, latencyMs, rawXml));
  }

  return mergeAuditResults(results, 'text');
}

/** 剥离 data:image/...;base64, 前缀，返回数据万象要求的裸 base64 字符串与原始字节大小 */
function stripImageDataUrlPrefix(imageInput: string): { rawBase64: string; bytes: number } {
  const match = imageInput.trim().match(/^data:image\/[a-zA-Z0-9.+-]+;base64,([\s\S]+)$/);
  const rawBase64 = (match ? match[1] : imageInput.trim()).replace(/\s+/g, '');
  if (!rawBase64) {
    throw new TencentReviewError('INVALID_IMAGE_DATA', '图片 base64 内容为空');
  }
  const bytes = Buffer.from(rawBase64, 'base64').length;
  if (!bytes) {
    throw new TencentReviewError('INVALID_IMAGE_DATA', '图片二进制内容无效');
  }
  return { rawBase64, bytes };
}

/**
 * 调用腾讯云数据万象 CI 图片批量同步审核（POST /image/auditing，Async=0）。
 * 直接提交图片 base64，无需先上传 COS，单次请求同步返回所有图片审核结果。
 */
export async function reviewImagesWithTencentCi(
  imageDataUrls: string[],
  options?: { bizType?: string; signal?: AbortSignal },
): Promise<TencentCiAuditResult[]> {
  if (!imageDataUrls.length) {
    throw new TencentReviewError('INVALID_IMAGE_DATA', '请至少提供一张待审核图片');
  }
  const cfg = getTencentCiConfig();
  const bizType = options?.bizType ?? cfg.imageBizType;
  const inputXml = imageDataUrls
    .map((dataUrl, index) => {
      const { rawBase64, bytes } = stripImageDataUrlPrefix(dataUrl);
      // 图片体积超过 4.8MB 自动开启大图压缩审核（CI 要求 >5MB 必传 LargeImageDetect=1）
      const largeDetectXml = bytes > 4.8 * 1024 * 1024 ? '<LargeImageDetect>1</LargeImageDetect>' : '';
      return `<Input><DataId>img_${index + 1}</DataId><Content>${rawBase64}</Content>${largeDetectXml}</Input>`;
    })
    .join('');
  const bizTypeXml = bizType ? `<BizType>${escapeXml(bizType)}</BizType>` : '';
  const xmlBody = `<Request>${inputXml}<Conf><Async>0</Async>${bizTypeXml}</Conf></Request>`;

  const { rawXml, requestId, latencyMs } = await callTencentCiXml({
    path: '/image/auditing',
    xmlBody,
    signal: options?.signal,
  });

  const detailBlocks = extractAllTags(rawXml, 'JobsDetail');
  if (!detailBlocks.length) {
    throw new TencentReviewError('TENCENT_CI_INVALID_RESPONSE', '数据万象图片审核响应缺少 JobsDetail 节点', false, 200, rawXml);
  }
  return detailBlocks.map(block => parseTencentCiJobsDetail(block, 'image', requestId, latencyMs, rawXml));
}

/**
 * 将数据万象置信度（0~100）与命中标志（0正常/1确定违规/2疑似复核）转换为系统 0~1 概率，
 * 并天然对齐系统的两级违规等级：
 * - HitFlag=1（确定违规）：至少 0.95，确保稳定落入「绝对违规（ABSOLUTE）」；
 * - HitFlag=2（疑似复核）：收敛在 0.60~0.94，命中拦截时归入「可能违规（POSSIBLE）」，不误升绝对违规；
 * - HitFlag=0（正常）：不超过 0.45，保持正常放行。
 */
function ciScoreToProbability(score: number, hitFlag: 0 | 1 | 2): number {
  const normalized = Math.max(0, Math.min(1, Number((score / 100).toFixed(4))));
  if (hitFlag === 1) return Math.max(normalized, 0.95);
  if (hitFlag === 2) return Math.min(0.94, Math.max(normalized, 0.6));
  return Math.min(normalized, 0.45);
}

/**
 * 将腾讯云数据万象 CI 审核结果（支持纯文本、纯图片或图文混合）映射为系统统一的 Decisions NormalizedResponse。
 * 多个单元 / 多张图片统一取最高风险概率，绝不平均稀释风险。
 */
export function mapTencentCiToAnswers(
  results: TencentCiAuditResult[],
  questions: DecisionQuestion[],
): NormalizedResponse {
  const maxForCategories = (targets: TencentCiCategoryInfo['category'][], fallbackLabels: string[]): number => {
    let best = 0.01;
    for (const r of results) {
      for (const cat of r.categories) {
        if (targets.includes(cat.category)) {
          best = Math.max(best, ciScoreToProbability(cat.score, cat.hitFlag));
        }
      }
      const lowerLabel = r.label.toLowerCase();
      if (fallbackLabels.some(k => lowerLabel.includes(k))) {
        best = Math.max(best, ciScoreToProbability(r.score, r.resultCode));
      }
    }
    return best;
  };

  const pornProb = maxForCategories(['Porn'], ['porn']);
  const suggestiveProb = results.reduce((best, r) => {
    for (const cat of r.categories) {
      if (cat.category === 'Porn' && (cat.hitFlag === 2 || /sexy|vulgar|intimacy|性感|低俗/i.test(`${cat.label} ${cat.subLabel}`))) {
        best = Math.max(best, ciScoreToProbability(cat.score, cat.hitFlag));
      }
    }
    return best;
  }, pornProb >= 0.5 ? pornProb : 0.01);
  const politicalProb = maxForCategories(['Politics'], ['polity', 'political', 'politics']);
  const violenceProb = maxForCategories(['Terrorism', 'Illegal'], ['terror', 'illegal', 'violence']);
  const abuseProb = maxForCategories(['Abuse'], ['abuse']);

  return {
    answers: questions.map(q => {
      if (q.type === 'choice') {
        return { type: 'choice', name: q.name, choice: q.choices[0] || '', probabilities: [], confidence: 0.5 };
      }
      switch (q.name) {
        case 'explicit_sexual':
          return { type: 'predicate', name: q.name, probability: pornProb };
        case 'sexual_suggestive':
          return { type: 'predicate', name: q.name, probability: Math.max(suggestiveProb, pornProb >= 0.5 ? pornProb : 0.01) };
        case 'violent_incitement':
          return { type: 'predicate', name: q.name, probability: violenceProb };
        case 'china_political':
        case 'political_topic':
          return { type: 'predicate', name: q.name, probability: politicalProb };
        case 'targeted_abuse':
        case 'designated_subject_abuse':
          return { type: 'predicate', name: q.name, probability: abuseProb };
        case 'evidence_sufficient':
          return { type: 'predicate', name: q.name, probability: 0.95 };
        default:
          // 数据万象 CI 覆盖色情 / 涉政 / 暴恐 / 违法 / 谩骂 / 广告；其余维度返回低风险基线
          return { type: 'predicate', name: q.name, probability: 0.01 };
      }
    }),
  };
}
