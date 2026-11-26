import { execFile } from 'node:child_process';
import { channelOf, decisionCandidates, endpointOf, type DecisionModel, type DecisionProtocol, type DecisionRole } from './models';
import {
  getTencentCiConfig,
  mapTencentCiToAnswers,
  reviewImagesWithTencentCi,
  reviewTextWithTencentCi,
  TencentReviewError,
  type TencentCiAuditResult,
} from '../tencent/client';

/** Internal, vendor-neutral question. */
export type DecisionQuestion =
  | {type:'predicate';name:string;instructions:string}
  | {type:'choice';name:string;instructions:string;choices:string[]};

/** Internal content: framing for the judge, the data to judge, optional images. */
export interface DecisionContent {
  developer:string;
  text:string;
  /** Images with a short placeholder used in logs instead of the base64 data. */
  images?:Array<{dataUrl:string;placeholder:string}>;
  meta?:Record<string,unknown>;
}

/**
 * Normalized answers, always in the OpenAI Decisions shape so callers validate one format:
 *  predicate: {type:'predicate',name,probability}
 *  choice:    {type:'choice',name,choice,probabilities:[{value,probability}],confidence}
 *  refusal:   {type:'refusal',name}
 */
export type NormalizedResponse = {answers:Array<Record<string,unknown>>};

export interface DecisionAttemptLog {
  model_id:string; attempt:number; sent:boolean; method:'POST'; url:string;
  request_headers:Record<string,string>; request_body:unknown;
  status:number|null; response_body:string|null; latency_ms:number; error:string|null;
}

export class DecisionError extends Error {
  constructor(public code: string, message: string, public transient = false) { super(message); }
}

const LOGGED_HEADERS = {'Content-Type':'application/json','Authorization':'Bearer ***'};
const MAX_LOGGED_RESPONSE = 50_000;
const sleep = (ms: number) => new Promise(resolve=>setTimeout(resolve,ms));

/**
 * Node's built-in fetch does not route through HTTP_PROXY/HTTPS_PROXY by default, whereas OpenAI official API
 * (`api.openai.com`) requires the local proxy when set. Uses `curl` (which honours HTTP_PROXY/HTTPS_PROXY natively)
 * when a proxy is configured or for direct OpenAI calls, with stdin payload so no secrets or user text appear in argv.
 */
async function postJson(url: string, apiKey: string, body: string, timeoutMs: number, signal: AbortSignal): Promise<{ok:boolean;status:number;text:string}> {
  const needsProxy = url.startsWith('https://api.openai.com/') && Boolean(process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY);
  if (!needsProxy) {
    const response = await fetch(url,{method:'POST',signal,cache:'no-store',headers:{'content-type':'application/json',authorization:`Bearer ${apiKey}`},body});
    return {ok:response.ok,status:response.status,text:await response.text()};
  }
  const maxTimeSec = Math.max(2, Math.ceil(timeoutMs / 1000));
  return new Promise((resolve, reject) => {
    const child = execFile(
      'curl',
      ['-sS', '-X', 'POST', url, '-m', String(maxTimeSec), '-H', 'Content-Type: application/json', '-H', `Authorization: Bearer ${apiKey}`, '--data-binary', '@-', '-w', '\n__HTTP_STATUS__:%{http_code}'],
      { maxBuffer: 10 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        const marker = '\n__HTTP_STATUS__:';
        const idx = stdout.lastIndexOf(marker);
        if (idx === -1) {
          reject(new Error('Invalid curl response'));
          return;
        }
        const text = stdout.slice(0, idx);
        const status = Number(stdout.slice(idx + marker.length).trim()) || 0;
        resolve({ ok: status >= 200 && status < 300, status, text });
      }
    );
    const onAbort = () => child.kill();
    signal.addEventListener('abort', onAbort, { once: true });
    child.on('close', () => signal.removeEventListener('abort', onAbort));
    child.stdin?.end(body);
  });
}

// ---------- Adapters ----------
interface Adapter {
  build(model: DecisionModel, content: DecisionContent, questions: DecisionQuestion[], redact: boolean): unknown;
  normalize(raw: unknown, questions: DecisionQuestion[]): NormalizedResponse|null;
}

const openaiDecisions: Adapter = {
  build(model,content,questions,redact) {
    const user: unknown[] = [];
    if (content.text.trim()) user.push({type:'input_text',text:content.text});
    for (const image of content.images||[]) user.push({type:'input_image',image_url:redact?image.placeholder:image.dataUrl});
    if (content.meta) user.push({type:'input_json',data:content.meta});
    const input: unknown[] = [];
    if (content.developer.trim()) input.push({role:'developer',content:content.developer});
    input.push({role:'user',content:user});
    return {model:model.model,input,
      questions:questions.map(q=>q.type==='choice'?{type:'choice',name:q.name,instructions:q.instructions,choices:q.choices.map(value=>({value}))}:q)};
  },
  normalize(raw) {
    return raw && typeof raw==='object' && Array.isArray((raw as NormalizedResponse).answers) ? raw as NormalizedResponse : null;
  },
};

/** Aliyun Model Studio "System One": state + questions keyed by id; yes/no is `noul`, options go in `criteria`. Text only. */
const aliyunSystemOne: Adapter = {
  build(model,content,questions) {
    return {model:model.model,state:{说明:content.developer,待判断内容:content.text,...(content.meta?{附加信息:content.meta}:{})},
      questions:Object.fromEntries(questions.map(q=>[q.name,q.type==='choice'
        ? {type:'choice',instructions:q.instructions,criteria:Object.fromEntries(q.choices.map(c=>[c,c]))}
        : {type:'noul',instructions:q.instructions}]))};
  },
  normalize(raw,questions) {
    const answers = raw && typeof raw==='object' ? (raw as {answers?:unknown}).answers : null;
    if (!answers || typeof answers!=='object' || Array.isArray(answers)) return null;
    const byId = answers as Record<string,Record<string,unknown>>;
    return {answers:questions.filter(q=>q.name in byId).map(q=>{
      const a = byId[q.name];
      if (a?.type==='noul' && q.type==='predicate') return {type:'predicate',name:q.name,probability:a.noul};
      if (a?.type==='choice' && q.type==='choice') {
        const probs = a.probabilities && typeof a.probabilities==='object' ? Object.entries(a.probabilities as Record<string,unknown>).map(([value,probability])=>({value,probability})) : [];
        return {type:'choice',name:q.name,choice:a.choice,probabilities:probs,confidence:a.confidence};
      }
      return {type:String(a?.type??'invalid'),name:q.name};
    })};
  },
};

/**
 * Google Gemini Decisions (`gemini-decision-1`) adapter, also compatible with relay gateways:
 * - Sends `questions` keyed by name (`noul` for yes/no predicates, `choice` with `criteria` for multiple choice).
 * - Accepts both keyed-object `answers` (`type: 'noul' | 'predicate'`, `probability` or `noul`) and array `answers`.
 */
const googleDecisions: Adapter = {
  build(model,content,questions,redact) {
    const user: unknown[] = [];
    if (content.text.trim()) user.push({type:'input_text',text:content.text});
    for (const image of content.images||[]) user.push({type:'input_image',image_url:redact?image.placeholder:image.dataUrl});
    if (content.meta) user.push({type:'input_json',data:content.meta});
    const messages: unknown[] = [];
    if (content.developer.trim()) messages.push({role:'developer',content:content.developer});
    messages.push({role:'user',content:user});
    return {
      model:model.model,
      input:content.images?.length || content.meta
        ? messages
        : `${content.developer}\n\n${content.text}`,
      questions:Object.fromEntries(questions.map(q=>[q.name,q.type==='choice'
        ? {type:'choice',instructions:q.instructions,criteria:Object.fromEntries(q.choices.map(c=>[c,c]))}
        : {type:'noul',instructions:q.instructions}])),
    };
  },
  normalize(raw,questions) {
    if (!raw || typeof raw!=='object') return null;
    const rawAnswers = (raw as {answers?:unknown}).answers;
    if (Array.isArray(rawAnswers)) {
      return {answers:rawAnswers.map(item=>{
        if (!item || typeof item!=='object') return {type:'invalid'};
        const rec = item as Record<string,unknown>;
        if (rec.type==='noul') return {type:'predicate',name:rec.name,probability:typeof rec.probability==='number'?rec.probability:rec.noul};
        return rec;
      })};
    }
    if (!rawAnswers || typeof rawAnswers!=='object') return null;
    const byId = rawAnswers as Record<string,Record<string,unknown>>;
    return {answers:questions.filter(q=>q.name in byId).map(q=>{
      const a = byId[q.name];
      if ((a?.type==='noul' || a?.type==='predicate') && q.type==='predicate') {
        const prob = typeof a.probability==='number' ? a.probability : a.noul;
        return {type:'predicate',name:q.name,probability:prob};
      }
      if (a?.type==='choice' && q.type==='choice') {
        const probs = Array.isArray(a.probabilities)
          ? a.probabilities
          : a.probabilities && typeof a.probabilities==='object'
            ? Object.entries(a.probabilities as Record<string,unknown>).map(([value,probability])=>({value,probability}))
            : [];
        return {type:'choice',name:q.name,choice:a.choice,probabilities:probs,confidence:a.confidence};
      }
      if (a?.type==='refusal') return {type:'refusal',name:q.name};
      return {type:String(a?.type??'invalid'),name:q.name};
    })};
  },
};

/**
 * LoopRouter unified System One (`POST https://api.looprouter.com/v1/systemone`) for
 * `decision-model-preview` (Aliyun Bailian, 纯文本) and `doubao-seed-2-1-lite-260915` (Volcengine Doubao, 支持多模态图文):
 * - 纯文本请求：`state` 传 JSON 对象 `{instructions, message, meta?}`；
 * - 多模态图文请求（如豆包）：`state` 传多模态对象数组 `[{type:'text', text:...}, {type:'image', image_url:..., detail:'high'}]`；
 * - `noul` 包含 `criteria: {"true": ..., "false": ...}`；
 * - `choice` 返回 `{"type": "choice", "choice": "<key>", "probabilities": {...}}`（`confidence` 可缺省）。
 */
const looprouterSystemOne: Adapter = {
  build(model,content,questions,redact) {
    const hasText = Boolean(content.text.trim());
    const textPayload = {
      ...(content.developer.trim()?{instructions:content.developer}:{}),
      message:content.text,
      ...(content.meta?{meta:content.meta}:{}),
    };
    const imageNodes = (content.images||[]).map(image=>({
      type:'image',
      image_url:redact?image.placeholder:image.dataUrl,
      detail:'high',
    }));
    // 纯图片审核请求：state 仅传 image 节点数组，不附带额外的 text 说明字段
    const state = imageNodes.length
      ? (hasText ? [{type:'text',text:textPayload},...imageNodes] : imageNodes)
      : textPayload;
    return {
      model:model.model,
      state,
      questions:Object.fromEntries(questions.map(q=>[q.name,q.type==='choice'
        ? {type:'choice',instructions:q.instructions,criteria:Object.fromEntries(q.choices.map(c=>[c,c]))}
        : {type:'noul',instructions:q.instructions,criteria:{true:'符合该规则描述的情况',false:'不符合或属于排除情况'}}])),
    };
  },
  normalize(raw,questions) {
    const answers = raw && typeof raw==='object' ? (raw as {answers?:unknown}).answers : null;
    if (!answers || typeof answers!=='object' || Array.isArray(answers)) return null;
    const byId = answers as Record<string,Record<string,unknown>>;
    return {answers:questions.filter(q=>q.name in byId).map(q=>{
      const a = byId[q.name];
      if (a?.type==='noul' && q.type==='predicate') return {type:'predicate',name:q.name,probability:a.noul};
      if (a?.type==='choice' && q.type==='choice') {
        const probMap = a.probabilities && typeof a.probabilities==='object' ? a.probabilities as Record<string,unknown> : null;
        const probs = probMap
          ? Object.entries(probMap).map(([value,probability])=>({value,probability}))
          : typeof a.choice==='string' ? [{value:a.choice,probability:1}] : [];
        const pickedProb = typeof a.choice==='string' && probMap && typeof probMap[a.choice]==='number'
          ? probMap[a.choice] as number
          : undefined;
        const confidence = typeof a.confidence==='number' ? a.confidence : (pickedProb ?? 1);
        return {type:'choice',name:q.name,choice:a.choice,probabilities:probs,confidence};
      }
      return {type:String(a?.type??'invalid'),name:q.name};
    })};
  },
};

const ADAPTERS: Partial<Record<DecisionProtocol,Adapter>> = {
  'openai-decisions':openaiDecisions,
  'google-decisions':googleDecisions,
  'looprouter-systemone':looprouterSystemOne,
  'aliyun-systemone':aliyunSystemOne,
};

/** 剥离审核调度器附加的系统说明前缀，提取真正需要送往数据万象 CI 的纯用户文本 */
function extractAuditTextForCi(content: DecisionContent): string {
  const modality = typeof content.meta?.modality === 'string' ? content.meta.modality : '';
  if (modality === 'image') return '';
  const raw = (content.text || '').trim();
  const stripped = raw.replace(/^待审核的生成提示词[^\n]*：\n?/, '').trim();
  return stripped || raw;
}

/** 腾讯云数据万象 CI 专用执行入口（统一支持纯文本、纯图片与图文混合同步审核），输出 Decisions NormalizedResponse 与调用日志 */
async function askTencentModel(
  model: DecisionModel,
  content: DecisionContent,
  questions: DecisionQuestion[],
  log: (entry: DecisionAttemptLog) => void,
  deadlineAt?: number,
): Promise<NormalizedResponse> {
  const url = endpointOf(model)!;
  const cfg = getTencentCiConfig();
  const remainingMs = deadlineAt !== undefined ? Math.round(deadlineAt - performance.now()) : model.timeout_ms;
  if (deadlineAt !== undefined && remainingMs <= 150) {
    throw new DecisionError('TOTAL_TIMEOUT', '超过总审核耗时限制，已放弃本次审核', true);
  }
  const effectiveTimeoutMs = Math.max(1000, Math.min(model.timeout_ms, remainingMs));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), effectiveTimeoutMs);
  const started = performance.now();
  const ciHeaders = { 'Content-Type': 'application/xml; charset=utf-8', Authorization: 'q-sign-algorithm=sha1 ***' };

  const textToAudit = extractAuditTextForCi(content);
  const imagesToAudit = content.images || [];

  try {
    if (!textToAudit && !imagesToAudit.length) {
      throw new DecisionError('INVALID_INPUT', '未提供可供数据万象审核的文本或图片内容', false);
    }

    // 文本与图片并行调用数据万象同步审核，降低图文混合审核耗时
    const [textResult, imageResults] = await Promise.all([
      textToAudit ? reviewTextWithTencentCi(textToAudit, { signal: controller.signal }) : Promise.resolve(null),
      imagesToAudit.length
        ? reviewImagesWithTencentCi(imagesToAudit.map(i => i.dataUrl), { signal: controller.signal })
        : Promise.resolve<TencentCiAuditResult[]>([]),
    ]);

    const allResults: TencentCiAuditResult[] = [
      ...(textResult ? [textResult] : []),
      ...imageResults,
    ];
    const normalized = mapTencentCiToAnswers(allResults, questions);
    const endpoints: string[] = [];
    if (textResult) endpoints.push('/text/auditing');
    if (imageResults.length) endpoints.push('/image/auditing');

    log({
      model_id: model.id,
      attempt: 1,
      sent: true,
      method: 'POST',
      url: `${url}${endpoints.join(' + ')}`,
      request_headers: ciHeaders,
      request_body: {
        bucket: cfg.bucket,
        region: cfg.region,
        text_length: textToAudit.length,
        images: imagesToAudit.map(i => i.placeholder),
        text_biz_type: cfg.textBizType || undefined,
        image_biz_type: cfg.imageBizType || undefined,
      },
      status: 200,
      response_body: JSON.stringify({
        text: textResult ? { suggestion: textResult.suggestion, label: textResult.label, score: textResult.score, keywords: textResult.keywords, categories: textResult.categories, jobId: textResult.jobId } : null,
        images: imageResults.map(r => ({ suggestion: r.suggestion, label: r.label, score: r.score, keywords: r.keywords, categories: r.categories, jobId: r.jobId })),
      }).slice(0, MAX_LOGGED_RESPONSE),
      latency_ms: Math.round(performance.now() - started),
      error: null,
    });
    return normalized;
  } catch (error) {
    const latency_ms = Math.round(performance.now() - started);
    if (error instanceof DecisionError) {
      log({
        model_id: model.id,
        attempt: 1,
        sent: false,
        method: 'POST',
        url,
        request_headers: ciHeaders,
        request_body: { bucket: cfg.bucket, region: cfg.region, text_length: textToAudit.length, images: imagesToAudit.map(i => i.placeholder) },
        status: null,
        response_body: null,
        latency_ms,
        error: error.message,
      });
      throw error;
    }
    const err = error instanceof TencentReviewError
      ? new DecisionError(error.code, error.message, error.transient)
      : controller.signal.aborted
        ? new DecisionError('TIMEOUT', '腾讯云数据万象审核超时', true)
        : new DecisionError('UNAVAILABLE', error instanceof Error ? error.message : '无法连接腾讯云数据万象服务', true);
    log({
      model_id: model.id,
      attempt: 1,
      sent: true,
      method: 'POST',
      url: `${url}${textToAudit && !imagesToAudit.length ? '/text/auditing' : !textToAudit ? '/image/auditing' : '/text+image/auditing'}`,
      request_headers: ciHeaders,
      request_body: { bucket: cfg.bucket, region: cfg.region, text_length: textToAudit.length, images: imagesToAudit.map(i => i.placeholder) },
      status: error instanceof TencentReviewError ? error.status : null,
      response_body: error instanceof TencentReviewError && error.rawResponse ? error.rawResponse.slice(0, MAX_LOGGED_RESPONSE) : null,
      latency_ms,
      error: err.message,
    });
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Transport ----------
/** One model, one chunk of questions; fails over to next model immediately on timeout/error (retries once only when switching LoopRouter group key). */
async function requestChunk(model: DecisionModel, content: DecisionContent, questions: DecisionQuestion[], log: (entry: DecisionAttemptLog)=>void, timeoutOverrideMs?: number): Promise<NormalizedResponse> {
  const channel = channelOf(model);
  const adapter = ADAPTERS[channel.protocol];
  if (!adapter) throw new DecisionError('UNSUPPORTED_PROTOCOL', `协议 ${channel.protocol} 不支持通用适配器`);
  const url = endpointOf(model)!;
  const primaryKey = process.env[channel.keyEnv]!.trim();
  const fallbackGroupKey = channel.keyEnv === 'LOOPROUTER_API_KEY' ? process.env.LOOPROUTER_DECISIONS_API_KEY?.trim() : undefined;
  let activeKey = primaryKey;
  const effectiveTimeoutMs = timeoutOverrideMs ? Math.max(500, Math.min(model.timeout_ms, timeoutOverrideMs)) : model.timeout_ms;
  const body = JSON.stringify(adapter.build(model,content,questions,false));
  const logged = adapter.build(model,content,questions,true);
  let lastError = new DecisionError('PROVIDER_ERROR','判定服务请求失败',true);
  for (let attempt=0;attempt<2;attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(()=>controller.abort(),effectiveTimeoutMs);
    const started = performance.now();
    const record = (status: number|null, text: string|null, error: string|null) => log({model_id:model.id,attempt:attempt+1,sent:true,method:'POST',url,
      request_headers:LOGGED_HEADERS,request_body:logged,status,response_body:text===null?null:text.slice(0,MAX_LOGGED_RESPONSE),
      latency_ms:Math.round(performance.now()-started),error});
    try {
      const response = await postJson(url,activeKey,body,effectiveTimeoutMs,controller.signal);
      const text = response.text;
      if (response.status===429) { lastError = new DecisionError('RATE_LIMITED','判定服务限流',true); record(response.status,text,lastError.message); break; }
      if (response.status>=500) {
        let detail = `判定服务错误（HTTP ${response.status}）`;
        try {
          const errObj = (JSON.parse(text) as {error?:{code?:string;message?:string}})?.error;
          const groupMatch = errObj?.message?.match(/No available channel for model (\S+) under group (\S+)/i);
          if (groupMatch) {
            detail = `当前 Key 分组（${groupMatch[2]}）未开通模型 ${groupMatch[1]}`;
            if (fallbackGroupKey && activeKey !== fallbackGroupKey) {
              activeKey = fallbackGroupKey;
              continue;
            }
            record(response.status,text,detail);
            throw new DecisionError('MODEL_GROUP_MISMATCH',detail,false);
          }
        } catch (inner) {
          if (inner instanceof DecisionError) throw inner;
        }
        lastError = new DecisionError('PROVIDER_ERROR',detail,true);
        record(response.status,text,lastError.message);
        break;
      }
      // Upstream error bodies can echo request content: they go to the admin-only call log, never into user-facing errors.
      if (!response.ok) { record(response.status,text,`请求被拒绝（HTTP ${response.status}）`); throw new DecisionError('PROVIDER_REJECTED',`判定请求被拒绝（HTTP ${response.status}）`); }
      let parsed: unknown = null;
      try { parsed = JSON.parse(text); } catch { parsed = null; }
      const normalized = adapter.normalize(parsed,questions);
      record(response.status,text,normalized?null:'响应格式无法识别');
      if (!normalized) throw new DecisionError('INVALID_RESPONSE','判定服务响应格式无法识别');
      return normalized;
    } catch (error) {
      if (error instanceof DecisionError) throw error;
      lastError = controller.signal.aborted ? new DecisionError('TIMEOUT','判定服务超时',true) : new DecisionError('UNAVAILABLE','无法连接判定服务',true);
      record(null,null,lastError.message);
      break;
    } finally { clearTimeout(timer); }
  }
  throw lastError;
}

/** Asks one specific model, splitting questions by the channel's per-request limit and merging the answers. */
export async function askModel(model: DecisionModel, content: DecisionContent, questions: DecisionQuestion[], log: (entry: DecisionAttemptLog)=>void = ()=>{}, deadlineAt?: number): Promise<NormalizedResponse> {
  const channel = channelOf(model);
  if (channel.protocol === 'tencent-ci-review') {
    return askTencentModel(model, content, questions, log, deadlineAt);
  }
  if (content.images?.length && !channel.supportsImages) throw new DecisionError('IMAGES_UNSUPPORTED',`${channel.label} 不支持图片输入`);
  const answers: NormalizedResponse['answers'] = [];
  for (let i=0;i<questions.length;i+=channel.maxQuestions) {
    let remainingMs: number|undefined;
    if (deadlineAt !== undefined) {
      remainingMs = Math.round(deadlineAt - performance.now());
      if (remainingMs <= 150) throw new DecisionError('TOTAL_TIMEOUT','超过总审核耗时限制，已放弃本次审核',true);
    }
    answers.push(...(await requestChunk(model,content,questions.slice(i,i+channel.maxQuestions),log,remainingMs)).answers);
  }
  return {answers};
}

/**
 * Asks the models assigned to a role in order (preferred model -> primary -> backup -> other enabled channels),
 * skipping models that can't take images when images are present. If a channel times out or fails, immediately jumps
 * to the next candidate until `deadlineAt` is reached.
 */
export async function askDecisions(role: DecisionRole, content: DecisionContent, questions: DecisionQuestion[], log: (entry: DecisionAttemptLog)=>void = ()=>{}, options?: {preferredModelId?: string|null; deadlineAt?: number}) {
  const candidates = decisionCandidates(role, options?.preferredModelId).filter(model=>{
    const ch = channelOf(model);
    if (content.images?.length && !ch.supportsImages) return false;
    return true;
  });
  if (!candidates.length) throw new DecisionError('NO_MODEL',content.images?.length?'没有可用且支持图片的判定模型':'没有可用的判定模型');
  let lastError: DecisionError = new DecisionError('NO_MODEL','没有可用的判定模型');
  for (let idx=0; idx<candidates.length; idx++) {
    const model = candidates[idx];
    const nextCandidate = candidates[idx+1];
    if (options?.deadlineAt !== undefined && performance.now() >= options.deadlineAt - 150) {
      throw new DecisionError('TOTAL_TIMEOUT','超过总审核耗时限制，已放弃本次审核',true);
    }
    const prevFailure = idx > 0 ? {model:candidates[idx-1].id, error:lastError.message} : null;
    const wrappedLog = (entry: DecisionAttemptLog) => {
      let enrichedError = entry.error;
      if (enrichedError && nextCandidate) {
        enrichedError = `${enrichedError} → 已触发兜底，自动切换至下一顺位模型 ${nextCandidate.id}（${nextCandidate.model}）`;
      } else if (enrichedError && !nextCandidate) {
        enrichedError = `${enrichedError}（已无更多可用兜底模型）`;
      } else if (!enrichedError && prevFailure) {
        enrichedError = `兜底接管成功（因上一顺位 ${prevFailure.model} 失败：${prevFailure.error}）`;
      }
      log({...entry, error:enrichedError});
    };
    try { return {response:await askModel(model,content,questions,wrappedLog,options?.deadlineAt),modelId:model.id,model:model.model}; }
    catch (error) {
      lastError = error instanceof DecisionError ? error : new DecisionError('PROVIDER_ERROR','判定失败');
      if (lastError.code === 'TOTAL_TIMEOUT') throw lastError;
    }
  }
  throw lastError;
}
