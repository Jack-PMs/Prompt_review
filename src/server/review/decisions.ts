import { askDecisions, DecisionError, type DecisionAttemptLog, type DecisionContent, type DecisionQuestion } from '../decision/client';
import { decisionRoleStatus } from '../decision/models';
import { DEVELOPER_PREAMBLE } from './policy';
import type { ProviderMode, ReviewRule, SignalStatus } from './types';

export type UnitContent =
  | {modality:'text';unit_id:string;text:string}
  | {modality:'image';unit_id:string;dataUrl:string;asset_id:string;bytes:number;sha256:string}
  | {modality:'combined';unit_id:string;text:string;images:Array<{dataUrl:string;asset_id:string;bytes:number;sha256:string}>};

/** One outbound Decisions request as it was sent (key masked, image data replaced by a reference). */
export type ApiCallLog = DecisionAttemptLog & {unit_id:string};
export type CallLogger = (entry: ApiCallLog) => void;

/** Marker the admin UI swaps back for the real image when copying a replayable cURL command. */
export const imagePlaceholder = (unit: {asset_id:string;bytes:number;sha256:string}) =>
  `[IMAGE:${unit.asset_id}] 图片数据已省略（${unit.bytes.toLocaleString('en-US')} 字节，sha256 ${unit.sha256.slice(0,16)}…）`;

export interface Answer { signal_status: SignalStatus; probability: number|null }

export class ProviderError extends Error {
  constructor(public code: string, message: string, public transient = false) { super(message); }
}

export function reviewMode(): ProviderMode {
  return process.env.REVIEW_PROVIDER_MODE?.trim()==='live' ? 'live' : 'mock';
}
/** Live review is possible when at least one decision model assigned to review is usable. */
export function liveKeyConfigured() { return decisionRoleStatus('review').available; }

/**
 * Validates a Decisions response against the questions that were asked.
 * Refusals, missing or duplicate names, wrong types and out-of-range probabilities are failures —
 * they are reported as such with probability=null, never treated as 0.
 */
export function validateAnswers(raw: unknown, names: string[]): Map<string,Answer> {
  const result = new Map<string,Answer>(names.map(name=>[name,{signal_status:'MISSING',probability:null}]));
  const answers = raw && typeof raw==='object' && Array.isArray((raw as {answers?:unknown}).answers) ? (raw as {answers:unknown[]}).answers : null;
  if (!answers) { for (const name of names) result.set(name,{signal_status:'INVALID',probability:null}); return result; }
  const seen = new Map<string,number>();
  for (const item of answers) {
    const name = item && typeof item==='object' ? (item as {name?:unknown}).name : undefined;
    if (typeof name==='string') seen.set(name,(seen.get(name)||0)+1);
  }
  for (const item of answers) {
    if (!item || typeof item!=='object') continue;
    const {name,type,probability} = item as {name?:unknown;type?:unknown;probability?:unknown};
    if (typeof name!=='string' || !result.has(name)) continue;
    if ((seen.get(name)||0)>1) { result.set(name,{signal_status:'INVALID',probability:null}); continue; }
    if (type==='refusal') { result.set(name,{signal_status:'REFUSED',probability:null}); continue; }
    if (type!=='predicate' || typeof probability!=='number' || !Number.isFinite(probability) || probability<0 || probability>1) {
      result.set(name,{signal_status:'INVALID',probability:null}); continue;
    }
    result.set(name,{signal_status:'SUCCESS',probability});
  }
  return result;
}

function question(rule: ReviewRule): DecisionQuestion {
  const instructions = rule.exclusions?.trim() ? `${rule.instructions} 排除：${rule.exclusions}` : rule.instructions;
  return {type:'predicate',name:rule.name,instructions};
}

// Units can be judged separately or combined into a single multimodal call when the model supports images.
function unitContent(unit: UnitContent): DecisionContent {
  const meta = {unit_id:unit.unit_id,modality:unit.modality};
  if (unit.modality==='combined') {
    const trimmedText = unit.text.trim();
    // 若用户未填写任何提示词（多张纯图片审核），仅传纯图片节点，不附带额外文本或 meta 说明
    if (!trimmedText) {
      return {
        developer:'',
        text:'',
        images:unit.images.map(img=>({dataUrl:img.dataUrl,placeholder:imagePlaceholder(img)})),
      };
    }
    return {
      developer:DEVELOPER_PREAMBLE,
      meta,
      text:`待审核的生成提示词与参考图片（请同时审查提示词文字和所有参考图片，任一内容符合违规规则即判定命中；“证据是否充分”看文字与图片是否清晰可辨）：\n${trimmedText}`,
      images:unit.images.map(img=>({dataUrl:img.dataUrl,placeholder:imagePlaceholder(img)})),
    };
  }
  return unit.modality==='text'
    ? {developer:DEVELOPER_PREAMBLE,meta,text:`待审核的生成提示词（若提到参考图，参考图另行单独审核；此处只判断文字本身，“证据是否充分”只看文字是否完整可读）：\n${unit.text}`}
    : {developer:'',text:'',images:[{dataUrl:unit.dataUrl,placeholder:imagePlaceholder(unit)}]};
}

/** One review unit through the specified model or the decision models assigned to review (with automatic channel failover and total timeout budget). Every attempt is logged. */
export async function askLive(unit: UnitContent, rules: ReviewRule[], log: CallLogger = ()=>{}, preferredModelId?: string|null, deadlineAt?: number): Promise<Map<string,Answer>> {
  try {
    const content = unitContent(unit);
    const questions = rules.map(question);
    const wrapLog = (entry: DecisionAttemptLog) => log({...entry,unit_id:unit.unit_id});
    const {response} = await askDecisions('review',content,questions,wrapLog,{preferredModelId,deadlineAt});
    return validateAnswers(response,rules.map(rule=>rule.name));
  } catch (error) {
    if (error instanceof DecisionError) throw new ProviderError(error.code,error.message,error.transient);
    throw error;
  }
}

/**
 * Mock fixtures. Only these exact demo texts receive simulated answers; any other input — including
 * images — gets no answers, so arbitrary text can never obtain a fake "AI" verdict via keywords.
 */
export const MOCK_FIXTURES: Record<string,{label:string;answers:Record<string,number>}> = {
  '【演示】米色亚麻抱枕，放在客厅沙发上，柔和自然光':{label:'安全样本 → 放行',answers:{}},
  '【演示】联合国大会会场的新闻插画，代表们在讨论气候政策':{label:'涉政话题 → 只打标签',answers:{political_topic:0.98}},
  '【演示】性感姿态的人物写真，强调身材曲线':{label:'擦边样本 → 拦截',answers:{sexual_suggestive:0.66}},
  '【演示】号召大家明天带上武器去袭击某个具体地点':{label:'暴力煽动 → 拦截',answers:{violent_incitement:0.97}},
};

const sleep = (ms: number) => new Promise(resolve=>setTimeout(resolve,ms));

export async function askMock(unit: UnitContent, rules: ReviewRule[], log: CallLogger = ()=>{}): Promise<Map<string,Answer>> {
  await sleep(250);
  const fixture = unit.modality==='text' ? MOCK_FIXTURES[unit.text.trim()] : undefined;
  const simulated = fixture ? {model:'mock',answers:rules.map(rule=>({type:'predicate',name:rule.name,probability:fixture.answers[rule.name] ?? (rule.kind==='quality'?0.95:0.02)}))} : null;
  const loggedContent = unit.modality === 'text'
    ? unit.text
    : unit.modality === 'image'
      ? imagePlaceholder(unit)
      : { text: unit.text, images: unit.images.map(imagePlaceholder) };
  log({model_id:'mock',unit_id:unit.unit_id,attempt:1,sent:false,method:'POST',url:'（模拟模式，未发送）',request_headers:{},request_body:{questions:rules.map(question),content:loggedContent},
    status:null,response_body:simulated?JSON.stringify(simulated):null,latency_ms:250,
    error:simulated?'模拟模式：未发送，响应为模拟数据':'模拟模式：未发送；非演示样本没有模拟数据'});
  if (!fixture) throw new ProviderError('MOCK_NO_FIXTURE','模拟模式只对固定演示样本返回模拟数据');
  return new Map(rules.map(rule=>[rule.name,{signal_status:'SUCCESS',probability:fixture.answers[rule.name] ?? (rule.kind==='quality'?0.95:0.02)}]));
}
