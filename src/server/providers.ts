import { execFile } from 'node:child_process';
import { AppError } from './validation';
import type { ModelConfig } from './types';

export const providerEnv: Record<ModelConfig['provider'],string> = {
  openai: 'OPENAI_API_KEY', gemini: 'GEMINI_API_KEY', qwen: 'DASHSCOPE_API_KEY', deepseek: 'DEEPSEEK_API_KEY',
  apiyi: 'APIYI_API_KEY', bananarouter: 'BANANA_ROUTER_API_KEY', runninghub: 'RUNNINGHUB_API_KEY',
};

export function hasProviderKey(provider: ModelConfig['provider']) {
  return Boolean(process.env[providerEnv[provider]]?.trim());
}

export function keyBinding(model: ModelConfig) {
  return {env:providerEnv[model.provider],configured:hasProviderKey(model.provider)};
}

export interface ProviderOutput {
  content: string;
  inputTokens: number | null;
  outputTokens: number | null;
  upstreamMs: number;
}

export interface ProviderCallOptions {
  responseSchema?: {name:string;schema:Record<string,unknown>};
  maxOutputTokens?: number;
  temperature?: number;
  /** Image URLs or data URLs attached to the user message (vision-capable models only). */
  images?: string[];
}

async function requestJson(url: string, headers: Record<string,string>, body: unknown, timeoutMs: number): Promise<unknown> {
  const needsProxy = url.startsWith('https://api.openai.com/') && Boolean(process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY);
  if (needsProxy) {
    const payload = JSON.stringify(body);
    const maxTimeSec = Math.max(2, Math.ceil(timeoutMs / 1000));
    const headerArgs = Object.entries({'content-type':'application/json',...headers}).flatMap(([k,v]) => ['-H', `${k}: ${v}`]);
    return new Promise((resolve, reject) => {
      const child = execFile(
        'curl',
        ['-sS', '-X', 'POST', url, '-m', String(maxTimeSec), ...headerArgs, '--data-binary', '@-', '-w', '\n__HTTP_STATUS__:%{http_code}'],
        { maxBuffer: 10 * 1024 * 1024 },
        (error, stdout) => {
          if (error) {
            reject(new AppError('PROVIDER_UNAVAILABLE', 502, '无法连接模型服务'));
            return;
          }
          const marker = '\n__HTTP_STATUS__:';
          const idx = stdout.lastIndexOf(marker);
          const status = idx === -1 ? 0 : Number(stdout.slice(idx + marker.length).trim()) || 0;
          const text = idx === -1 ? stdout : stdout.slice(0, idx);
          if (status < 200 || status >= 300) {
            reject(new AppError(status === 429 ? 'PROVIDER_RATE_LIMITED' : 'PROVIDER_ERROR', 502,
              status === 429 ? '模型服务繁忙，请稍后重试' : `模型服务请求失败（HTTP ${status}）`));
            return;
          }
          try { resolve(JSON.parse(text)); }
          catch { reject(new AppError('PROVIDER_ERROR', 502, '模型服务响应格式无效')); }
        }
      );
      child.stdin?.end(payload);
    });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method:'POST', headers:{'content-type':'application/json',...headers}, body:JSON.stringify(body), signal:controller.signal, cache:'no-store' });
    if (!response.ok) {
      // Upstream bodies can contain secrets and user content. Never forward or log them.
      throw new AppError(response.status === 429 ? 'PROVIDER_RATE_LIMITED' : 'PROVIDER_ERROR', 502,
        response.status === 429 ? '模型服务繁忙，请稍后重试' : `模型服务请求失败（HTTP ${response.status}）`);
    }
    return await response.json();
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (controller.signal.aborted) throw new AppError('PROVIDER_TIMEOUT',504,'模型响应超时');
    throw new AppError('PROVIDER_UNAVAILABLE',502,'无法连接模型服务');
  } finally { clearTimeout(timer); }
}

function asRecord(value: unknown): Record<string,unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string,unknown> : {};
}

const enhancementSchema = {
  type:'object',
  properties:{
    status:{type:'string',enum:['enhanced','fallback','clarify']},
    intent_category:{type:'string'},
    prompt:{type:'string'},
    negative_prompt:{type:'string'},
    preserved_constraints:{type:'array',items:{type:'string'}},
    assumptions:{type:'array',items:{type:'string'}},
    conflicts:{type:'array',items:{type:'string'}},
    user_notice:{type:'string'},
  },
  required:['status','intent_category','prompt','negative_prompt','preserved_constraints','assumptions','conflicts','user_notice'],
  additionalProperties:false,
} as const;

function responseFormat(provider: ModelConfig['provider'], model: string, custom?: ProviderCallOptions['responseSchema']) {
  // 仅对强制要求或原生高速支持 json_schema 的网关启用；DashScope qwen 使用原生 json_object 消除受限解码编译开销
  if (provider === 'bananarouter' || (provider === 'apiyi' && !model.startsWith('deepseek-'))) {
    return {type:'json_schema',json_schema:{name:custom?.name||'enhancement',strict:true,schema:custom?.schema||enhancementSchema}};
  }
  return {type:'json_object'};
}

/** Gemini's native API takes inline base64 only; remote URLs are not fetched by this route. */
function geminiImagePart(image: string) {
  const match = /^data:(image\/[a-z+]+);base64,(.+)$/s.exec(image);
  if (!match) throw new AppError('VISION_UNSUPPORTED',502,'该模型渠道不支持图片链接，请改用 base64');
  return {inline_data:{mime_type:match[1],data:match[2]}};
}

export async function callProvider(model: ModelConfig, system: string, user: string, callOptions: ProviderCallOptions = {}): Promise<ProviderOutput> {
  const key = process.env[providerEnv[model.provider]]?.trim();
  if (!key) throw new AppError('PROVIDER_NOT_CONFIGURED',503,`${model.provider} 尚未配置服务端密钥`);
  const start = performance.now();
  if (model.provider === 'gemini') {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model.model)}:generateContent`;
    const raw = asRecord(await requestJson(url, {'x-goog-api-key':key}, {
      systemInstruction: {parts:[{text:system}]},
      contents:[{role:'user',parts:[{text:user},...(callOptions.images||[]).map(geminiImagePart)]}],
      generationConfig:{responseMimeType:'application/json',maxOutputTokens:callOptions.maxOutputTokens||model.max_output_tokens,temperature:callOptions.temperature??0.3},
    }, model.timeout_ms));
    const candidate = asRecord((raw.candidates as unknown[]|undefined)?.[0]);
    const content = asRecord(candidate.content);
    const parts = Array.isArray(content.parts) ? content.parts : [];
    const text = parts.map(part => asRecord(part).text).filter(x => typeof x === 'string').join('');
    const usage = asRecord(raw.usageMetadata);
    return {content:text,inputTokens:Number(usage.promptTokenCount)||null,outputTokens:Number(usage.candidatesTokenCount)||null,upstreamMs:Math.round(performance.now()-start)};
  }
  const endpoints = {
    openai: 'https://api.openai.com/v1/chat/completions',
    qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    deepseek: 'https://api.deepseek.com/chat/completions',
    apiyi: 'https://api.apiyi.com/v1/chat/completions',
    bananarouter: 'https://api.bananarouter.com/v1/chat/completions',
    runninghub: 'https://llm.runninghub.cn/v1/chat/completions',
  } as const;
  const options = model.provider === 'openai'
    ? {max_completion_tokens:callOptions.maxOutputTokens||model.max_output_tokens,reasoning_effort:'none'}
    : model.provider === 'qwen' || (model.provider === 'runninghub' && model.model.startsWith('qwen/'))
      ? {max_tokens:callOptions.maxOutputTokens||model.max_output_tokens,enable_thinking:false,temperature:callOptions.temperature??0.3}
      : model.provider === 'runninghub' && /^(deepseek|bytedance)\//.test(model.model)
        ? {max_tokens:callOptions.maxOutputTokens||model.max_output_tokens,thinking:{type:'disabled'},temperature:callOptions.temperature??0.3}
        : {max_tokens:callOptions.maxOutputTokens||model.max_output_tokens,temperature:callOptions.temperature??0.3};
  const raw = asRecord(await requestJson(endpoints[model.provider], {authorization:`Bearer ${key}`}, {
    model:model.model,
    messages:[{role:'system',content:system},{role:'user',content:callOptions.images?.length
      ? [{type:'text',text:user},...callOptions.images.map(url=>({type:'image_url',image_url:{url,detail:'low'}}))]
      : user}],
    response_format:responseFormat(model.provider,model.model,callOptions.responseSchema),
    ...options,
  },model.timeout_ms));
  const choice = asRecord((raw.choices as unknown[]|undefined)?.[0]);
  const message = asRecord(choice.message);
  const usage = asRecord(raw.usage);
  return {content:typeof message.content === 'string' ? message.content : '',inputTokens:Number(usage.prompt_tokens)||null,outputTokens:Number(usage.completion_tokens)||null,upstreamMs:Math.round(performance.now()-start)};
}
