'use client';

import { useState } from 'react';
import { api, errorMessage, formatDate, ms, pct, type Tone } from '../lib';
import { Alert, Badge, Icon, Spinner } from '../ui';

export type ReviewCheck = {name:string;unit_id:string;status:string;resolved_by:string|null;detail:string};
export type ReviewUnit = {unit_id:string;modality:'text'|'image';asset_id:string|null};
export type ReviewSignal = {unit_id:string;rule_id:string;name:string;signal_status:string;probability:number|null};
export type ViolationLevel = 'NONE' | 'POSSIBLE' | 'ABSOLUTE';
export type ReviewTask = {
  task_id:string;stage:string;provider_mode:'mock'|'live';model:string|null;policy_version:string;execution_status:string;action:'ALLOW'|'BLOCK'|'REVIEW';
  violation_level?:ViolationLevel;violation_label?:string;
  reason_codes:string[];topics:string[];block_messages?:string[];block_message?:string|null;prompt:string;asset_ids:string[];content_hash:string;units:ReviewUnit[];checks:ReviewCheck[];
  generation_eligible:boolean;publish_eligible:boolean;is_demo:boolean;revision:number;decided_by:string|null;latency_ms:number|null;error:string|null;
  created_at:string;updated_at:string;
};
export type ApiCall = {id:number;unit_id:string;model_id:string|null;attempt:number;sent:boolean;method:string;url:string;request_headers:Record<string,string>;
  request_body:unknown;status:number|null;response_body:string|null;latency_ms:number;error:string|null;created_at:string};
export type ReviewDetail = ReviewTask & {
  signals:ReviewSignal[];
  api_calls:ApiCall[];
  assets:Array<{id:string;sha256?:string;mime?:string;bytes?:number;width?:number;height?:number;missing?:boolean}>;
};
export type ReviewModelOption = {id:string;model:string;label:string;supports_text?:boolean;supports_images:boolean};
export type ReviewHealth = {mode:'mock'|'live';model:string;selected_model_id?:string;backup_model_id?:string;total_timeout_ms?:number;models?:ReviewModelOption[];key_configured:boolean;config_error:string|null;
  last_check:{ok:boolean;at:string;latency_ms:number;message:string}|null;policy_version:string};

export const ruleTitles: Record<string,string> = {
  'IP-001':'版权角色 / IP',
  'SEX-001':'露骨色情','SEX-002':'性暗示 / 擦边','TOPIC-001':'涉政话题','CN-POL-001':'中国政治','ABUSE-001':'针对性辱骂',
  'SUBJECT-001':'指定对象侮辱','VIO-001':'暴力煽动','QUALITY-001':'证据充分',
};

const reasonLabels: Record<string,string> = {
  SIGNAL_REFUSED:'部分规则模型拒答，未取得有效判定',SIGNAL_MISSING:'部分规则缺少答案，未取得有效判定',
  SIGNAL_INVALID:'部分规则答案格式无效，未取得有效判定',SIGNAL_FAILED:'部分规则判定失败，未取得有效判定',
  EVIDENCE_INSUFFICIENT:'模型认为内容不够清晰，结论仅供参考',EXECUTION_FAILED:'审核执行失败，未取得有效判定',
  IP_CHECK_INCOMPLETE:'版权角色检查未完成，暂不放行；请重试审核',
  REVIEW_TIMEOUT_BYPASSED:'超过总审核耗时限制，已自动放弃审核并放行',
  MANUAL_ALLOW:'管理员已手动放行',
  MANUAL_BLOCK:'管理员已手动拦截',
  VIOLATION_POSSIBLE:'违规等级：可能违规（风险区间命中，建议人工复核）',
  VIOLATION_ABSOLUTE:'违规等级：绝对违规（触发高确信红线）',
  POLICY_NOT_VALIDATED:'（旧任务）规则未校准',CHECK_INCOMPLETE:'有检查未完成',
};
export function reasonLabel(code: string) {
  const [kind,rule] = code.split(':');
  if (kind==='RULE_REVIEW') return `（旧任务）命中「${ruleTitles[rule]||rule}」`;
  if (kind==='RULE_BLOCK') return `命中「${ruleTitles[rule]||rule}」，达到拦截阈值`;
  return reasonLabels[code] || code;
}

export const actionMeta: Record<string,{label:string;tone:Tone}> = {
  ALLOW:{label:'通过',tone:'success'},BLOCK:{label:'拦截',tone:'danger'},REVIEW:{label:'未处置（旧任务）',tone:'neutral'},
};

/** 终态处置徽章：区分「通过 / 人工放行」「可能违规」「绝对违规」「人工拦截」 */
export function ActionBadge({task}:{task:Pick<ReviewTask,'action'|'execution_status'|'decided_by'|'violation_level'>}) {
  if (task.execution_status==='PENDING'||task.execution_status==='RUNNING') return <Badge tone="info">{task.execution_status==='PENDING'?'排队中':'审核中'}</Badge>;
  if (task.action === 'ALLOW') {
    return <Badge tone="success">{task.decided_by ? '人工放行' : '通过'}</Badge>;
  }
  if (task.action === 'BLOCK') {
    if (task.decided_by) return <Badge tone="danger">人工拦截</Badge>;
    if (task.violation_level === 'POSSIBLE') return <Badge tone="warning">可能违规</Badge>;
    return <Badge tone="danger">绝对违规</Badge>;
  }
  const meta = actionMeta[task.action];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

export function ModeBadge({mode,demo}:{mode:'mock'|'live';demo?:boolean}) {
  return mode==='mock'||demo ? <Badge tone="neutral" icon={false}>模拟数据</Badge> : <Badge tone="info" icon={false}>真实 API</Badge>;
}

const unitName = (unit: ReviewUnit) => unit.modality==='text' ? '提示词' : `图片 ${unit.unit_id.replace('img_','')}`;
const checkTone: Record<string,Tone> = {SUCCESS:'success',FAILED:'danger',NOT_RUN:'warning',NOT_APPLICABLE:'neutral'};
const checkLabel: Record<string,string> = {SUCCESS:'已完成',FAILED:'失败',NOT_RUN:'未运行',NOT_APPLICABLE:'不适用'};
const signalLabel: Record<string,string> = {REFUSED:'拒答',MISSING:'缺失',INVALID:'无效',FAILED:'失败'};

type TencentNativeCategory = {category:string;hitFlag:0|1|2;score:number;label?:string;subLabel?:string;keywords?:string[]};
type TencentNativeResult = {suggestion?:string;label?:string;subLabel?:string;score?:number;keywords?:string[];categories?:TencentNativeCategory[];jobId?:string};

const TENCENT_CAT_NAMES: Record<string,string> = {
  Porn:'涉黄 (Porn)',
  Politics:'涉政 (Politics)',
  Terrorism:'暴恐 (Terrorism)',
  Illegal:'违法 (Illegal)',
  Abuse:'谩骂 (Abuse)',
  Ads:'广告 (Ads)',
};

/** 判断任务是否为腾讯云数据万象 CI 渠道，并从 API 响应日志中提取真实原生审核结果 */
function extractTencentNative(task: ReviewDetail): {isTencent:boolean;text:TencentNativeResult|null;images:TencentNativeResult[]} {
  const ciCalls = task.api_calls.filter(c => c.model_id === 'tencent-ci-content-review' || c.url.includes('.ci.'));
  const isTencent = ciCalls.length > 0 || Boolean(task.model?.includes('tencent-ci'));
  let text: TencentNativeResult|null = null;
  const images: TencentNativeResult[] = [];
  for (const call of ciCalls) {
    if (!call.response_body) continue;
    try {
      const parsed = JSON.parse(call.response_body) as {text?:TencentNativeResult|null;images?:TencentNativeResult[]};
      if (parsed?.text) text = parsed.text;
      if (Array.isArray(parsed?.images)) images.push(...parsed.images);
    } catch {
      // 忽略非 JSON 响应体
    }
  }
  return {isTencent,text,images};
}

/** 渲染腾讯云数据万象 CI 真实原生审核结果（不再显示拼凑的 8 维 AI 规则） */
function TencentNativeTable({native,title}:{native:TencentNativeResult|null;title?:string}) {
  if (!native) return <p className="muted-inline">暂无腾讯云数据万象原生返回详情</p>;
  const sug = String(native.suggestion || 'pass').toLowerCase();
  const sugTone: Tone = sug === 'block' ? 'danger' : sug === 'review' ? 'warning' : 'success';
  const sugText = sug === 'block' ? 'BLOCK · 违规' : sug === 'review' ? 'REVIEW · 疑似复核' : 'PASS · 正常';
  const cats = native.categories || [];
  const kws = native.keywords || [];
  return <div className="stack" style={{gap:8}}>
    <div style={{display:'flex',flexWrap:'wrap',alignItems:'center',gap:6}}>
      {title && <strong style={{fontSize:12}}>{title}</strong>}
      <Badge tone={sugTone}>{sugText}</Badge>
      <span className="muted-inline">原生标签：<code>{native.label || 'Normal'}{native.subLabel ? ` / ${native.subLabel}` : ''}</code> · 最高分 <strong className="num">{native.score ?? 0}</strong></span>
    </div>
    {kws.length > 0 && <p className="muted-inline" style={{fontSize:12}}>命中敏感词：<code>{kws.join('、')}</code></p>}
    {cats.length > 0 && <table className="table signal-table">
      <thead><tr><th>数据万象原生维度</th><th className="r">命中标志</th><th className="r">分值 (0~100)</th></tr></thead>
      <tbody>{cats.map(c => <tr key={c.category}>
        <td>{TENCENT_CAT_NAMES[c.category] || c.category}{c.subLabel ? <span className="muted-inline">（{c.subLabel}）</span> : null}</td>
        <td className="r">{c.hitFlag === 1 ? <Badge tone="danger">违规 (1)</Badge> : c.hitFlag === 2 ? <Badge tone="warning">疑似 (2)</Badge> : <Badge tone="neutral" icon={false}>正常 (0)</Badge>}</td>
        <td className="r num"><span className={c.hitFlag === 1 ? 'sig-bad' : c.hitFlag === 2 ? 'sig-warn' : ''}>{c.score}</span></td>
      </tr>)}</tbody>
    </table>}
  </div>;
}

/** Evidence view: original content per unit, its checks and per-rule signals (or native Tencent CI output). */
export function TaskEvidence({task}:{task:ReviewDetail}) {
  const tencent = extractTencentNative(task);
  const isCombined = task.api_calls.some(c=>c.unit_id==='combined') && task.units.length>1;
  if (isCombined) {
    const failedChecks = task.checks.filter(c=>c.status!=='SUCCESS' && c.status!=='NOT_APPLICABLE');
    const firstUnitId = task.units[0]?.unit_id;
    const unitSignals = task.signals.filter(s=>s.unit_id===firstUnitId);
    const imageUnits = task.units.filter(u=>u.modality==='image');
    return <div className="units">
      <section className="unit">
        <header className="unit-head"><strong>提示词 + 参考图（合并判定）</strong></header>
        <div className="unit-body">
          <div className="stack" style={{gap:10}}>
            {task.prompt && <pre className="unit-text">{task.prompt}</pre>}
            {imageUnits.length>0 && <div className="ref-grid">{imageUnits.map(unit=>{
              const asset = task.assets.find(a=>a.id===unit.asset_id);
              return asset?.missing ? <p key={unit.unit_id} className="field-error">素材缺失</p>
                // eslint-disable-next-line @next/next/no-img-element -- private evidence served by an authenticated route
                : <a key={unit.unit_id} href={`/api/review/assets/${unit.asset_id}?purpose=evidence`} target="_blank" rel="noreferrer" className="unit-image"><img src={`/api/review/assets/${unit.asset_id}?purpose=evidence`} alt={unitName(unit)}/><span>{asset?.width}×{asset?.height}</span></a>;
            })}</div>}
          </div>
          <div className="unit-side">
            {failedChecks.length>0&&<ul className="unit-checks">
              {failedChecks.map(c=><li key={`${c.unit_id}-${c.name}`}><Badge tone={checkTone[c.status]||'neutral'}>{checkLabel[c.status]||c.status}</Badge><span>{c.detail}</span></li>)}
            </ul>}
            {tencent.isTencent ? (
              <div className="stack" style={{gap:12}}>
                {tencent.text && <TencentNativeTable native={tencent.text} title="文本原生审核"/>}
                {tencent.images.map((imgNative, idx) => <TencentNativeTable key={idx} native={imgNative} title={`图片 ${idx + 1} 原生审核`}/>)}
              </div>
            ) : unitSignals.length>0&&<table className="table signal-table"><thead><tr><th>规则</th><th className="r">信号</th></tr></thead><tbody>{unitSignals.map(s=><tr key={s.rule_id}>
              <td>{ruleTitles[s.rule_id]||s.rule_id}</td>
              <td className="r num">{s.signal_status==='SUCCESS'&&s.probability!==null?<span className={signalClass(s)}>{pct(s.probability)}</span>:<Badge tone="danger">{signalLabel[s.signal_status]||s.signal_status}</Badge>}</td></tr>)}</tbody></table>}
          </div>
        </div>
      </section>
    </div>;
  }
  return <div className="units">{task.units.map(unit=>{
    const failedChecks = task.checks.filter(c=>c.unit_id===unit.unit_id && c.status!=='SUCCESS' && c.status!=='NOT_APPLICABLE');
    const unitSignals = task.signals.filter(s=>s.unit_id===unit.unit_id);
    const asset = task.assets.find(a=>a.id===unit.asset_id);
    const imgIdx = unit.modality === 'image' ? Math.max(0, Number(unit.unit_id.replace('img_','')) - 1) : -1;
    const unitTencentNative = unit.modality === 'text' ? tencent.text : (tencent.images[imgIdx] ?? tencent.images[0] ?? null);
    return <section className="unit" key={unit.unit_id}>
      <header className="unit-head"><strong>{unitName(unit)}</strong></header>
      <div className="unit-body">
        {unit.modality==='text'
          ? <pre className="unit-text">{task.prompt}</pre>
          : asset?.missing ? <p className="field-error">素材缺失</p>
          // eslint-disable-next-line @next/next/no-img-element -- private evidence served by an authenticated route
          : <a href={`/api/review/assets/${unit.asset_id}?purpose=evidence`} target="_blank" rel="noreferrer" className="unit-image"><img src={`/api/review/assets/${unit.asset_id}?purpose=evidence`} alt={unitName(unit)}/><span>{asset?.width}×{asset?.height}</span></a>}
        <div className="unit-side">
          {(failedChecks.length>0 || !task.checks.some(c=>c.unit_id===unit.unit_id))&&<ul className="unit-checks">
            {failedChecks.map(c=><li key={c.name}><Badge tone={checkTone[c.status]||'neutral'}>{checkLabel[c.status]||c.status}</Badge><span>{c.detail}</span></li>)}
            {!task.checks.some(c=>c.unit_id===unit.unit_id)&&<li><Badge tone="warning">未运行</Badge><span>尚未完成检查</span></li>}
          </ul>}
          {tencent.isTencent ? (
            <TencentNativeTable native={unitTencentNative}/>
          ) : unitSignals.length>0&&<table className="table signal-table"><thead><tr><th>规则</th><th className="r">信号</th></tr></thead><tbody>{unitSignals.map(s=><tr key={s.rule_id}>
            <td>{ruleTitles[s.rule_id]||s.rule_id}</td>
            <td className="r num">{s.signal_status==='SUCCESS'&&s.probability!==null?<span className={signalClass(s)}>{pct(s.probability)}</span>:<Badge tone="danger">{signalLabel[s.signal_status]||s.signal_status}</Badge>}</td></tr>)}</tbody></table>}
        </div>
      </div>
    </section>;
  })}</div>;
}

function signalClass(s: ReviewSignal) {
  if (s.probability===null) return '';
  if (s.rule_id==='QUALITY-001') return s.probability<0.5?'sig-warn':'sig-ok';
  if (s.rule_id==='TOPIC-001') return s.probability>=0.5?'sig-info':'';
  return s.probability>=0.9?'sig-bad':s.probability>=0.5?'sig-warn':'';
}

/** Verdict header: action, reasons, topics, provenance and admin manual override controls. */
export function TaskSummary({task,onUpdated}:{task:ReviewTask;onUpdated?:(next:ReviewDetail)=>void}) {
  const [note,setNote] = useState('');
  const [busy,setBusy] = useState<'ALLOW'|'BLOCK'|''>('');
  const [err,setErr] = useState('');

  async function override(nextAction: 'ALLOW'|'BLOCK') {
    setBusy(nextAction); setErr('');
    try {
      const updated = await api<ReviewDetail>(`/api/review/tasks/${task.task_id}`,{
        method:'PATCH',
        body:JSON.stringify({action:nextAction,note:note.trim(),revision:task.revision}),
      });
      setNote('');
      onUpdated?.(updated);
    } catch (cause) {
      setErr(errorMessage(cause,nextAction==='ALLOW'?'手动放行失败':'改判失败'));
    } finally {
      setBusy('');
    }
  }

  const canManualOperate = Boolean(onUpdated) && task.execution_status!=='PENDING' && task.execution_status!=='RUNNING';
  return <div className="verdict">
    <div className="verdict-main"><ActionBadge task={task}/><ModeBadge mode={task.provider_mode} demo={task.is_demo}/>
      {task.decided_by&&<Badge tone="neutral" icon={false}>复核人：{task.decided_by}</Badge>}
      {task.topics.map(t=><Badge key={t} tone="info" icon={false}>{t}</Badge>)}</div>
    {task.action==='BLOCK'&&task.block_message&&<p className="field-error">{task.block_message}</p>}
    {canManualOperate && (
      <div style={{display:'flex',flexWrap:'wrap',alignItems:'center',gap:8,padding:'10px 12px',borderRadius:10,background:'var(--surface-2, rgba(15,23,42,0.04))',border:'1px solid var(--border)'}}>
        {task.action==='BLOCK' ? (
          <>
            <input
              type="text"
              value={note}
              onChange={e=>setNote(e.target.value)}
              maxLength={200}
              placeholder={task.violation_level==='POSSIBLE'?'可选：填写手动放行备注（可能违规，复核无风险可直接放行）':'可选：填写手动放行备注（写入审计日志）'}
              style={{flex:1,minWidth:180}}
              disabled={busy!==''}
            />
            <button type="button" className="btn btn-primary btn-sm" onClick={()=>void override('ALLOW')} disabled={busy!==''}>
              {busy==='ALLOW'?<Spinner/>:<Icon name="ok" size={14}/>}手动放行
            </button>
          </>
        ) : (
          <>
            <span className="muted-inline" style={{flex:1}}>当前已放行{task.decided_by ? `（由 ${task.decided_by} 手动放行）` : ''}，如需撤销可改判为拦截</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={()=>void override('BLOCK')} disabled={busy!==''}>
              {busy==='BLOCK'&&<Spinner/>}改判为拦截
            </button>
          </>
        )}
      </div>
    )}
    {err&&<Alert tone="danger">{err}</Alert>}
    {task.reason_codes.length>0&&<><p className="reasons-label">判定依据</p><ul className="reasons">{task.reason_codes.map(code=><li key={code}>{reasonLabel(code)}</li>)}</ul></>}
    {task.error&&<p className="field-error">{task.error}</p>}
    <dl className="facts">
      <div><dt>判定</dt><dd>{task.provider_mode==='live'?task.model:'模拟'}{task.latency_ms!==null?` · ${task.latency_ms.toLocaleString('zh-CN')} ms`:''}</dd></div>
      <div><dt>任务</dt><dd><code>{task.task_id}</code> · {formatDate(task.created_at)}</dd></div>
    </dl>
  </div>;
}

const pretty = (value: unknown) => JSON.stringify(value,null,2);
function prettyText(text: string|null) {
  if (text===null) return '';
  try { return pretty(JSON.parse(text)); } catch { return text; }
}

/** Swaps "[IMAGE:ast_x] …" placeholders for the real image as a data URL, so the copied request can be replayed. */
async function withRealImages(body: unknown): Promise<string> {
  let json = pretty(body);
  const ids = [...new Set([...json.matchAll(/\[IMAGE:(ast_[0-9a-f]{24})\][^"]*/g)].map(m=>m[1]))];
  for (const id of ids) {
    const blob = await (await fetch(`/api/review/assets/${id}`,{cache:'no-store'})).blob();
    const dataUrl = await new Promise<string>(resolve=>{ const reader = new FileReader(); reader.onload = ()=>resolve(String(reader.result)); reader.readAsDataURL(blob); });
    json = json.replace(new RegExp(`\\[IMAGE:${id}\\][^"]*`,'g'),dataUrl);
  }
  return json;
}

function CopyButton({label,getText}:{label:string;getText:()=>string|Promise<string>}) {
  const [state,setState] = useState<'idle'|'busy'|'done'|'error'>('idle');
  async function copy() {
    setState('busy');
    try { await navigator.clipboard.writeText(await getText()); setState('done'); }
    catch { setState('error'); }
    setTimeout(()=>setState('idle'),1600);
  }
  return <button type="button" className="btn btn-ghost btn-sm" onClick={()=>void copy()} disabled={state==='busy'}>
    <Icon name={state==='done'?'ok':'copy'} size={14}/>{state==='done'?'已复制':state==='error'?'复制失败':label}</button>;
}

function statusBadge(call: ApiCall) {
  if (!call.sent) return <Badge icon={false}>未发送</Badge>;
  if (call.status===null) return <Badge tone="danger">无响应</Badge>;
  return <Badge tone={call.status<300?'success':'danger'} icon={false}>HTTP {call.status}</Badge>;
}

/** Every outbound Decisions request for a task, exactly as sent (key masked), with its raw response. */
export function TaskApiCalls({task}:{task:ReviewDetail}) {
  if (!task.api_calls.length) return null;
  const unitLabel = (id: string) => id==='combined' ? '提示词 + 参考图' : id==='prompt' ? '提示词' : `图片 ${id.replace('img_','')}`;
  const failedCalls = task.api_calls.filter(c => c.status===null || c.status>=300);
  const succeededCall = task.api_calls.find(c => c.status!==null && c.status<300);
  return <section className="api-calls">
    <h3 className="detail-heading">API 调用（{task.api_calls.length} 次）</h3>
    {failedCalls.length>0 && <div className="alert alert-warning" style={{marginBottom:10}}>
      <Icon name="warn" size={16}/>
      <div>
        <strong>模型调用失败，已启用兜底模型：</strong>
        {failedCalls.map(c => `${c.model_id}（${c.error || `HTTP ${c.status ?? '无响应'}，耗时 ${c.latency_ms} ms`}）`).join('；')}
        {succeededCall ? ` → 最终由兜底模型 ${succeededCall.model_id} 完成判定（${succeededCall.latency_ms} ms）` : ' → 所有候选模型均未成功'}
      </div>
    </div>}
    {task.api_calls.map((call,index)=>{
      const isFallbackSuccess = index>0 && call.status!==null && call.status<300 && task.api_calls.slice(0,index).some(prev=>prev.unit_id===call.unit_id && (prev.status===null || prev.status>=300));
      const isFailedTrigger = call.status===null || call.status>=300;
      const curl = async () => `curl -sS ${call.url} \\\n  -H 'Content-Type: application/json' \\\n  -H "Authorization: Bearer $LOOPROUTER_API_KEY" \\\n  --data-binary @- <<'JSON'\n${await withRealImages(call.request_body)}\nJSON`;
      return <details className="api-call" key={call.id} open={index===0 || isFailedTrigger || isFallbackSuccess}>
        <summary>
          <strong>{unitLabel(call.unit_id)}</strong>
          {call.model_id&&<code className="cell-sub inline">{call.model_id}</code>}
          {isFailedTrigger&&<Badge tone="warning" icon={false}>失败并触发兜底</Badge>}
          {isFallbackSuccess&&<Badge tone="info" icon={false}>兜底接管</Badge>}
          {call.attempt>1&&<span className="muted-inline">第 {call.attempt} 次</span>}
          {statusBadge(call)}
          <span className="muted-inline num">{ms(call.latency_ms)}</span>
        </summary>
        <div className="api-call-body">
          <div className="api-line"><code>{call.method} {call.url}</code></div>
          {call.error&&<p className="api-note" style={{fontWeight:500}}>{call.error}</p>}
          <div className="api-block">
            <div className="api-block-head"><span>请求</span><span><CopyButton label="复制 JSON" getText={()=>pretty(call.request_body)}/><CopyButton label="复制为 cURL" getText={curl}/></span></div>
            <pre className="code">{Object.entries(call.request_headers).map(([k,v])=>`${k}: ${v}`).join('\n')}{'\n\n'}{pretty(call.request_body)}</pre>
          </div>
          <div className="api-block">
            <div className="api-block-head"><span>响应{call.status!==null?` · HTTP ${call.status}`:''}</span>{call.response_body&&<CopyButton label="复制" getText={()=>prettyText(call.response_body)}/>}</div>
            {call.response_body!==null?<pre className="code">{prettyText(call.response_body)}</pre>:<p className="muted-inline">{call.sent?'没有收到响应':'未发送请求'}</p>}
          </div>
        </div>
      </details>;
    })}
  </section>;
}
