import type { ReviewTask } from './review/shared';

export type Model = {id:string;provider:string;model:string;enabled:number;timeout_ms:number;max_output_tokens:number;priority:number;updated_at:string;key_env:string;key_configured:boolean};
export type ReviewModel = {id:string;available:boolean;primary_available:boolean;active_id:string|null};
export type Config = {active_model_id:string;backup_model_id:string;intent_mode:'decisions'|'rules';decision_review_model_id:string;decision_backup_model_id:string;decision_intent_model_id:string;vision_model_id:string;vision_backup_model_id:string;vision_model:ReviewModel;fallback_scene:string;revision:number;review_model:ReviewModel;models:Model[]};
export type PromptVersion = {version:number;body:string;note:string;created_by:string;created_at:string};
export type Prompts = {active_version:number;versions:PromptVersion[];benchmarks:Array<{version:number;samples:number;success_rate:number}>;min_benchmark_samples:number};
export type Scene = {id:string;name:string;rules:string;fallback_scene:string;enabled:number;updated_at:string};
export type Run = {id:string;kind:string;model_id:string;failover_from:string|null;prompt_version:number;entry:string|null;status:string;intent_status:string|null;attempts:number;review_attempts:number;review_ms:number;review_model_id:string|null;image_count:number;vision_ms:number;vision_model_id:string|null;intent_ms:number;intent_check:string|null;total_ms:number;upstream_ms:number;input_tokens:number|null;output_tokens:number|null;error_code:string|null;input_text:string|null;output_json:string|null;created_at:string};
export type Stat = {model_id:string;prompt_version:number;samples:number;success_rate:number;p50_ms:number|null;p95_ms:number|null;avg_input_tokens:number|null;avg_output_tokens:number|null};
export type Runs = {runs:Run[];stats:Stat[];active_version:number};
export type Audit = {records:Array<{id:number;actor:string;action:string;subject:string;detail:string;created_at:string}>};
export type Check = {key:string;label:string;level:'ok'|'warn'|'fail';detail:string};
export type SceneStat = {entry:string|null;name:string;total:number;produced_rate:number|null;p50_ms:number|null;p95_ms:number|null};
export type ReviewDashboardData = {
  total:number; today_count:number; live_count:number; mock_count:number;
  allow_count:number; block_count:number; failed_count:number; allow_rate:number|null;
  avg_ms:number|null; p50_ms:number|null; p95_ms:number|null; min_ms:number|null; max_ms:number|null;
  latency_sample_mode:'live'|'all'; active_policy_version:string; active_decision_model:string;
  buckets:Array<{label:string;count:number;tone:'success'|'info'|'warning'|'danger'}>;
  rule_hits:Array<{rule_id:string;title:string;count:number}>;
  model_stats:Array<{model:string;count:number;avg_ms:number;p50_ms:number|null;p95_ms:number|null;min_ms:number;max_ms:number}>;
  recent_tasks:ReviewTask[];
};
export type OverviewData = {active_version:number;min_benchmark_samples:number;benchmark:Stat[];checks:Check[];
  review_dashboard:ReviewDashboardData;
  live:{days:number;total:number;produced_rate:number|null;p50_ms:number|null;p95_ms:number|null;retry_rate:number|null;failovers:number;
    outcomes:{enhanced:number;fallback:number;needs_revision:number;needs_clarification:number;failed:number};errors:Array<{code:string;count:number}>;
    feedback:{total:number;accepted:number;edited:number;rejected:number;adoption_rate:number|null};scenes:SceneStat[]}};
export type RevisionGuidance = {category:string;reason:string;suggestion:string};
export type TestResult = {model:string;requestId?:string;result?:Record<string,unknown>;metrics?:Record<string,unknown>;error?:string};

export type Tab = 'overview'|'playground'|'intent'|'prompts'|'models'|'scenes'|'settings'|'runs'|'audit'|'review'|'review-records'|'review-rules';
export const TABS: Tab[] = ['overview','playground','intent','prompts','models','scenes','settings','runs','audit','review','review-records','review-rules'];

/** Everything the console loads in one round; pages receive slices of it. */
export type ConsoleData = {config:Config;prompts:Prompts;runs:Runs;audit:Audit;scenes:Scene[];overview:OverviewData};

export async function api<T>(url:string,options?:RequestInit):Promise<T> {
  const response = await fetch(url,{...options,headers:{'content-type':'application/json',...(options?.headers||{})},cache:'no-store'});
  const data = await response.json().catch(()=>({}));
  if (!response.ok) throw new Error(data.error?.message||`请求失败（HTTP ${response.status}）`);
  return data as T;
}

export function errorMessage(cause:unknown,fallback:string) { return cause instanceof Error ? cause.message : fallback; }

export function formatDate(value:string) { return new Date(value).toLocaleString('zh-CN',{hour12:false}); }
export function formatTime(value:Date) { return value.toLocaleTimeString('zh-CN',{hour12:false}); }
export function pct(value:number|null|undefined) { return value===null||value===undefined?'—':`${Math.round(value*100)}%`; }
export function ms(value:number|null|undefined) { return value===null||value===undefined?'—':`${value.toLocaleString('zh-CN')} ms`; }

export const errorLabels: Record<string,string> = {
  INVALID_MODEL_OUTPUT:'模型输出无效',CONSTRAINT_MISSING:'遗漏明确约束',UNSAFE_MODEL_OUTPUT:'强化稿未过复核',CONTENT_REVIEW_UNAVAILABLE:'审核不可用',
  PROVIDER_TIMEOUT:'模型超时',PROVIDER_ERROR:'模型服务报错',PROVIDER_UNAVAILABLE:'无法连接模型',PROVIDER_RATE_LIMITED:'模型限流',
  PROVIDER_NOT_CONFIGURED:'缺少模型密钥',REFERENCE_IMAGE_UNAVAILABLE:'参考图识别不可用',VISION_UNSUPPORTED:'渠道不支持图片链接',UNSAFE_FALLBACK_SCENE:'兜底稿未过审核',INTERNAL_ERROR:'内部错误',INVALID_SCENE:'场景无效',
};

export const kindLabels: Record<string,string> = {live:'线上',playground:'测试',benchmark:'基准'};

export const providerLabels: Record<string,string> = {
  qwen:'阿里云百炼', bananarouter:'BananaRouter', apiyi:'API易', runninghub:'RunningHub',
  openai:'OpenAI', gemini:'Google', deepseek:'DeepSeek',
};

/** 直接展示实际调用上游接口使用的精确模型 ID */
export function formatModelLabel(m: Pick<Model,'id'|'model'|'provider'>): string {
  return m.model;
}

export function modelLabelById(id: string | null | undefined, models: Model[]): string {
  if (!id) return '—';
  const found = models.find(m => m.id === id);
  return found ? formatModelLabel(found) : id;
}

export type Tone = 'success'|'warning'|'danger'|'neutral'|'info';

/** One label + tone for a run, combining the HTTP-level status with the intent outcome. */
export function runOutcome(run:Pick<Run,'status'|'intent_status'>): {label:string;tone:Tone} {
  if (run.status==='failed') return {label:'失败',tone:'danger'};
  if (run.status==='needs_revision') return {label:'审核拦截',tone:'warning'};
  if (run.intent_status==='needs_clarification') return {label:'需补充信息',tone:'warning'};
  if (run.intent_status==='fallback') return {label:'兜底稿',tone:'neutral'};
  return {label:'正常强化',tone:'success'};
}
