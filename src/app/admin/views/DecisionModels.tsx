'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage, formatDate, type Tone } from '../lib';
import { Alert, Badge, Card, Field, Icon, Spinner, Toggle } from '../ui';

export type DecisionModelRow = {id:string;channel:string;model:string;workspace_id:string;enabled:boolean;timeout_ms:number;priority?:number;updated_at:string;
  channel_label:string;protocol:string;key_env:string;key_configured:boolean;supports_text?:boolean;supports_images:boolean;max_questions:number;needs_workspace:boolean;
  endpoint:string|null;unusable_reason:string|null;last_test:{ok:boolean;at:string;latency_ms:number;message:string}|null};
export type DecisionOverview = {models:DecisionModelRow[];channels:Array<{id:string;label:string;protocol:string;key_env:string;supports_text?:boolean;supports_images:boolean;max_questions:number;needs_workspace:boolean}>;
  assignments:{review:string;backup:string;intent:string;total_timeout_ms?:number}};

type Draft = {model:string;workspace_id:string;enabled:boolean;timeout_ms:number};
const protocolLabel: Record<string,string> = {
  'openai-decisions':'OpenAI Decisions 格式',
  'google-decisions':'Google Decisions 格式',
  'looprouter-systemone':'LoopRouter System One 格式',
  'aliyun-systemone':'阿里 System One 直连格式',
  'tencent-ci-review':'腾讯云数据万象 CI（文本 + 图片同步审核）',
};

/** Decision (judgment) models: registry of channel + model, with live tests. Used by content review and intent recognition. */
export default function DecisionModels({notify}:{notify:(message:string,tone?:Tone)=>void}) {
  const [data,setData] = useState<DecisionOverview|null>(null);
  const [drafts,setDrafts] = useState<Record<string,Draft>>({});
  const [busy,setBusy] = useState('');
  const [error,setError] = useState('');
  const [adding,setAdding] = useState(false);
  const [newChannel,setNewChannel] = useState('');
  const [newModel,setNewModel] = useState('');
  const [newWorkspace,setNewWorkspace] = useState('');
  const [totalTimeoutMs,setTotalTimeoutMs] = useState(12000);

  const load = useCallback(async()=>{
    try {
      const d = await api<DecisionOverview>('/api/admin/decision-models');
      setData(d);
      setNewChannel(c=>c||d.channels[0]?.id||'');
      if (d.assignments.total_timeout_ms) setTotalTimeoutMs(d.assignments.total_timeout_ms);
    }
    catch(cause) { setError(errorMessage(cause,'加载失败')); }
  },[]);
  useEffect(()=>{ void load(); },[load]);
  if (!data) return <Card title="判定模型">{error?<Alert tone="danger">{error}</Alert>:<Spinner/>}</Card>;

  const draft = (m: DecisionModelRow): Draft => drafts[m.id] || {model:m.model,workspace_id:m.workspace_id,enabled:m.enabled,timeout_ms:m.timeout_ms};
  const change = (m: DecisionModelRow, patch: Partial<Draft>) => setDrafts(old=>({...old,[m.id]:{...draft(m),...patch}}));
  const dirty = (m: DecisionModelRow) => JSON.stringify(draft(m))!==JSON.stringify({model:m.model,workspace_id:m.workspace_id,enabled:m.enabled,timeout_ms:m.timeout_ms});
  const reset = (id: string) => setDrafts(old=>{const next={...old};delete next[id];return next;});
  const roles = (id: string) => [id===data.assignments.intent&&'意图识别'].filter(Boolean) as string[];
  const selectedChannel = data.channels.find(c=>c.id===newChannel);
  const enabledModels = data.models.filter(m=>m.enabled && !m.unusable_reason);

  async function movePriority(index: number, delta: -1 | 1) {
    if (!data) return;
    const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex >= data.models.length) return;
    const ordered = data.models.map(m=>m.id);
    const [moved] = ordered.splice(index, 1);
    ordered.splice(nextIndex, 0, moved);
    setBusy('reorder');setError('');
    try {
      const updated = await api<DecisionOverview>('/api/admin/decision-models',{method:'PUT',body:JSON.stringify({ordered_ids:ordered})});
      setData(updated);
      notify('已更新渠道兜底顺序');
    } catch(cause) { setError(errorMessage(cause,'调整顺序失败')); }
    finally { setBusy(''); }
  }

  async function save(m: DecisionModelRow) {
    setBusy(m.id);setError('');
    try { await api(`/api/admin/decision-models/${m.id}`,{method:'PATCH',body:JSON.stringify({...draft(m),updated_at:m.updated_at})}); reset(m.id); await load(); notify(`${m.id} 已保存`); }
    catch(cause) { setError(`${m.id}：${errorMessage(cause,'保存失败')}`); }
    finally { setBusy(''); }
  }
  async function test(m: DecisionModelRow) {
    setBusy(m.id);setError('');
    try { const r = await api<{ok:boolean;message:string}>(`/api/admin/decision-models/${m.id}/test`,{method:'POST'}); await load(); notify(r.ok?`${m.id} 测试通过`:`${m.id} 测试未通过`,r.ok?'success':'danger'); }
    catch(cause) { setError(`${m.id}：${errorMessage(cause,'测试失败')}`); }
    finally { setBusy(''); }
  }
  async function add() {
    setBusy('new');setError('');
    try {
      const r = await api<{id:string}>('/api/admin/decision-models',{method:'POST',body:JSON.stringify({channel:newChannel,model:newModel.trim(),workspace_id:newWorkspace.trim()})});
      setAdding(false);setNewModel('');setNewWorkspace(''); await load(); notify(`已登记 ${r.id}（未启用），测试通过后再启用`);
    } catch(cause) { setError(errorMessage(cause,'登记失败')); }
    finally { setBusy(''); }
  }

  async function updateFailover(patch: {model_id?:string;backup_model_id?:string;total_timeout_ms?:number}) {
    setBusy('failover');setError('');
    try {
      await api('/api/review/health',{method:'PUT',body:JSON.stringify(patch)});
      await load();
      notify('渠道兜底与总超时设置已更新');
    } catch(cause) { setError(errorMessage(cause,'更新失败')); }
    finally { setBusy(''); }
  }

  return <Card title="判定模型（Decisions）" description="只做判断、不生成文字的模型；所有已启用模型按「兜底顺位」从 #1 到 #N 依次参与兜底，单渠道超时立即跳到下一顺位，超过总耗时上限直接放弃审核" flush
    actions={!adding&&<button className="btn btn-secondary btn-sm" onClick={()=>setAdding(true)}><Icon name="plus" size={14}/>登记模型</button>}>
    <div className="inline-form" style={{borderBottom:'1px solid var(--border)'}}>
      <div className="form-row" style={{alignItems:'flex-end'}}>
        <div className="field" style={{flex:1}}>
          <div className="field-label"><span className="label">全渠道级联兜底链路（共 {enabledModels.length} 个可用渠道参与，支持在下方表格任意上移/下移调整顺序）</span></div>
          <div style={{display:'flex',flexWrap:'wrap',alignItems:'center',gap:8,padding:'6px 0'}}>
            {enabledModels.map((m, idx) => (
              <span key={m.id} style={{display:'inline-flex',alignItems:'center',gap:6}}>
                <Badge tone={idx===0?'success':'info'} icon={false}>
                  #{idx+1} {idx===0?'首选':`第 ${idx} 兜底`}：{m.channel_label} · {m.model}（{m.timeout_ms}ms）
                </Badge>
                {idx < enabledModels.length - 1 && <span className="muted-inline">→</span>}
              </span>
            ))}
            <span className="muted-inline">→ 超过 {totalTimeoutMs} ms 直接放弃审核放行</span>
          </div>
        </div>
        <Field label="总耗时上限（ms）" htmlFor="dm-total-timeout" hint="超过此总时间直接放弃提示词审核并放行">
          <input
            id="dm-total-timeout"
            type="number"
            className="num narrow"
            min={2000}
            max={120000}
            step={1000}
            value={totalTimeoutMs}
            onChange={e=>setTotalTimeoutMs(Number(e.target.value))}
            onBlur={e=>{
              const clamped = Math.max(2000,Math.min(120000,Math.round(Number(e.target.value)||12000)));
              setTotalTimeoutMs(clamped);
              if (clamped !== data.assignments.total_timeout_ms) void updateFailover({total_timeout_ms:clamped});
            }}
            disabled={busy!==''}
          />
        </Field>
      </div>
    </div>
    {adding&&<div className="inline-form">
      <div className="form-row">
        <Field label="渠道" htmlFor="dm-channel" hint={selectedChannel?`${protocolLabel[selectedChannel.protocol]} · 密钥 ${selectedChannel.key_env} · ${selectedChannel.supports_images?'支持图片':'仅文字'} · 每次最多 ${selectedChannel.max_questions} 题`:undefined}>
          <select id="dm-channel" value={newChannel} onChange={e=>setNewChannel(e.target.value)}>{data.channels.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}</select></Field>
        <Field label="模型 ID" htmlFor="dm-model"><input id="dm-model" value={newModel} onChange={e=>setNewModel(e.target.value)} placeholder="例如 decision-model-preview"/></Field>
        {selectedChannel?.needs_workspace&&<Field label="工作空间 ID" htmlFor="dm-ws" hint="百炼控制台中的业务空间 ID"><input id="dm-ws" value={newWorkspace} onChange={e=>setNewWorkspace(e.target.value)}/></Field>}
      </div>
      <div className="actions"><button className="btn btn-primary btn-sm" onClick={()=>void add()} disabled={busy==='new'||!newModel.trim()}>{busy==='new'&&<Spinner/>}登记</button>
        <button className="btn btn-ghost btn-sm" onClick={()=>setAdding(false)}>取消</button></div>
    </div>}
    {error&&<div className="card-pad"><Alert tone="danger">{error}</Alert></div>}
    <div className="table-wrap"><table className="table table-form">
      <thead><tr><th>兜底顺位 / 排序</th><th>渠道 / 用途</th><th>模型 ID</th><th>工作空间</th><th>密钥</th><th>能力</th><th>启用</th><th className="r">单渠道超时（ms）</th><th>最近测试</th><th className="r"><span className="sr-only">操作</span></th></tr></thead>
      <tbody>{data.models.map((m,index)=>{const d=draft(m);const changed=dirty(m);return <tr key={m.id} className={changed?'row-dirty':undefined}>
        <td className="nowrap">
          <div style={{display:'flex',alignItems:'center',gap:6}}>
            <Badge tone={!d.enabled?'neutral':index===0?'success':'info'} icon={false}>
              {!d.enabled?'未参与':index===0?'#1 首选':`#${index+1} 兜底 ${index}`}
            </Badge>
            <div style={{display:'inline-flex',gap:2}}>
              <button type="button" className="btn btn-ghost btn-sm" style={{padding:'2px 6px'}} onClick={()=>void movePriority(index,-1)} disabled={index===0||busy!==''} title="上移顺位" aria-label={`上移 ${m.model}`}>↑</button>
              <button type="button" className="btn btn-ghost btn-sm" style={{padding:'2px 6px'}} onClick={()=>void movePriority(index,1)} disabled={index===data.models.length-1||busy!==''} title="下移顺位" aria-label={`下移 ${m.model}`}>↓</button>
            </div>
          </div>
        </td>
        <td><span className="cell-main">{m.channel_label}</span><span className="cell-sub">{protocolLabel[m.protocol]}</span>{roles(m.id).map(r=><Badge key={r} tone="info" icon={false}>{r}</Badge>)}</td>
        <td><input aria-label={`${m.id} 模型 ID`} value={d.model} onChange={e=>change(m,{model:e.target.value.trim()})}/></td>
        <td>{m.needs_workspace?<input aria-label={`${m.id} 工作空间 ID`} value={d.workspace_id} onChange={e=>change(m,{workspace_id:e.target.value.trim()})} placeholder="必填"/>:<span className="muted-inline">不需要</span>}</td>
        <td>{m.key_configured?<Badge tone="success">已配置</Badge>:<Badge tone="danger">未配置</Badge>}<code className="cell-sub">{m.key_env}</code></td>
        <td><span className="cell-main">{m.supports_text===false?'仅图片':m.supports_images?'文字 + 图片':'仅文字'}</span><span className="cell-sub">每次最多 {m.max_questions} 题</span></td>
        <td><Toggle checked={d.enabled} onChange={v=>change(m,{enabled:v})} label={`启用 ${m.id}`}/></td>
        <td className="r"><input className="num narrow" type="number" min={2000} max={60000} step={1000} aria-label={`${m.id} 超时`} value={d.timeout_ms} onChange={e=>change(m,{timeout_ms:Number(e.target.value)})}/></td>
        <td>{m.last_test?<><Badge tone={m.last_test.ok?'success':'danger'}>{m.last_test.ok?'通过':'未通过'}</Badge><span className="cell-sub" title={m.last_test.message}>{m.last_test.message}</span><span className="cell-sub">{formatDate(m.last_test.at)}</span></>
          :m.unusable_reason&&m.unusable_reason!=='未启用'?<span className="field-error">{m.unusable_reason}</span>:<span className="muted-inline">未测试</span>}</td>
        <td className="r nowrap">{changed?<><button className="btn btn-primary btn-sm" onClick={()=>void save(m)} disabled={busy!==''}>{busy===m.id&&<Spinner/>}保存</button>
          <button className="btn btn-ghost btn-sm" onClick={()=>reset(m.id)} disabled={busy!==''}>撤销</button></>
          :<button className="btn btn-secondary btn-sm" onClick={()=>void test(m)} disabled={busy!==''}>{busy===m.id&&<Spinner/>}测试</button>}</td>
      </tr>;})}</tbody></table></div>
  </Card>;
}
