'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage, formatDate, type Tone } from '../lib';
import { Alert, Badge, Card, Field, Spinner, type ConfirmFn } from '../ui';

type Rule = {
  rule_id:string;name:string;title:string;kind:'risk'|'topic'|'quality';
  instructions:string;exclusions:string;block_message?:string;modalities:string[];
  threshold:number|null;absolute_threshold?:number|null;
};
type Version = {version:string;rules:Rule[];note:string;created_by:string;created_at:string};

const kindText = {risk:'两级拦截：可能违规 / 绝对违规',topic:'仅打标签，不拦截',quality:'低于阈值标记“不够清晰”，不拦截'} as const;

export default function Rules({notify,confirm,refreshHealth}:{notify:(message:string,tone?:Tone)=>void;confirm:ConfirmFn;refreshHealth:()=>Promise<void>}) {
  const [data,setData] = useState<{active_version:string;versions:Version[]}|null>(null);
  const [drafts,setDrafts] = useState<Record<string,Rule>>({});
  const [note,setNote] = useState('');
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');

  const load = useCallback(async()=>{
    try { setData(await api('/api/review/policies')); setDrafts({}); setNote(''); }
    catch(cause) { setError(errorMessage(cause,'加载失败')); }
  },[]);
  useEffect(()=>{ void load(); },[load]);
  if (!data) return <div className="page">{error?<Alert tone="danger">{error}</Alert>:<Spinner/>}</div>;

  const active = data.versions.find(v=>v.version===data.active_version)!;
  const rule = (r: Rule) => drafts[r.rule_id] || r;
  const change = (r: Rule, patch: Partial<Rule>) => setDrafts(old=>({...old,[r.rule_id]:{...rule(r),...patch}}));
  const dirty = Object.keys(drafts).length>0;
  const invalidThresholds = Object.values(drafts).filter(
    r => r.kind==='risk' && r.threshold!==null && r.absolute_threshold!==null && r.absolute_threshold!==undefined && r.absolute_threshold < r.threshold,
  );

  async function save() {
    if (invalidThresholds.length>0) {
      setError(`以下规则的绝对违规阈值不能低于可能违规阈值：${invalidThresholds.map(r=>r.title).join('、')}`);
      return;
    }
    const ok = await confirm({title:'保存为新规则版本？',confirmLabel:'保存并启用',
      body:<p>将基于 {active.version} 创建新版本并立即用于之后提交的审核；历史版本和已有审核记录不变。</p>});
    if (!ok) return;
    setBusy(true);setError('');
    try {
      const result = await api<{version:string}>('/api/review/policies',{method:'POST',body:JSON.stringify({base_version:active.version,note,rules:Object.values(drafts)})});
      notify(`已启用 ${result.version}`); await load(); await refreshHealth();
    } catch(cause) { setError(errorMessage(cause,'保存失败')); }
    finally { setBusy(false); }
  }

  return <div className="page">
    <Card title={<>当前规则 {active.version}</>} description={`${active.note} · ${formatDate(active.created_at)} · 共 ${data.versions.length} 个版本`}>
      <p className="card-note">风险规则采用两级判定：达到「可能违规阈值」即拦截并标为橙黄色（便于后台筛选复核放行）；达到「绝对违规阈值」标为红色硬红线。</p>
    </Card>
    {active.rules.map(r=>{const value=rule(r);const thresholdConflict=r.kind==='risk'&&value.threshold!==null&&value.absolute_threshold!==null&&value.absolute_threshold!==undefined&&value.absolute_threshold<value.threshold;return <Card key={r.rule_id} title={<>{r.title}{drafts[r.rule_id]&&<Badge tone="warning">已修改</Badge>}</>}
      description={`${kindText[r.kind]} · 适用：${r.modalities.map(m=>m==='text'?'文字':'图片').join('、')}`}>
      <Field label="规则说明" htmlFor={`${r.rule_id}-ins`}><textarea id={`${r.rule_id}-ins`} rows={3} value={value.instructions} onChange={e=>change(r,{instructions:e.target.value,exclusions:''})} maxLength={1200}/></Field>
      {r.kind==='risk'&&<>
        <Field label="前端提示文案" htmlFor={`${r.rule_id}-msg`} hint="命中时在三笙通用生图输入框展示的提示语">
          <input id={`${r.rule_id}-msg`} value={value.block_message??''} onChange={e=>change(r,{block_message:e.target.value})} maxLength={200} placeholder={`该提示词可能涉及${r.title}，建议修改（可能影响生成结果）`}/></Field>
        <div className="form-row two">
          <Field label="可能违规阈值（拦截起点）" htmlFor={`${r.rule_id}-th`} hint="0～1，达到即拦截并标记为「可能违规」；留空不拦截">
            <input id={`${r.rule_id}-th`} className="num" type="number" min={0} max={1} step={0.05} value={value.threshold??''}
              onChange={e=>change(r,{threshold:e.target.value===''?null:Number(e.target.value)})}/></Field>
          <Field label="绝对违规阈值（硬红线）" htmlFor={`${r.rule_id}-abs-th`} hint="0～1，达到标记为「绝对违规」；须 ≥ 可能违规阈值，留空自动推导">
            <input id={`${r.rule_id}-abs-th`} className="num" type="number" min={0} max={1} step={0.05} value={value.absolute_threshold??''}
              onChange={e=>change(r,{absolute_threshold:e.target.value===''?null:Number(e.target.value)})}/></Field>
        </div>
        {thresholdConflict&&<p className="field-error">绝对违规阈值（{value.absolute_threshold}）不能低于可能违规阈值（{value.threshold}）</p>}
      </>}
      {r.kind==='quality'&&<div className="form-row">
        <Field label="清晰度阈值" htmlFor={`${r.rule_id}-th`} hint="0～1；留空表示不标记">
          <input id={`${r.rule_id}-th`} className="num" type="number" min={0} max={1} step={0.05} value={value.threshold??''}
            onChange={e=>change(r,{threshold:e.target.value===''?null:Number(e.target.value)})}/></Field>
      </div>}
    </Card>;})}
    {error&&<Alert tone="danger">{error}</Alert>}
    <div className="actions sticky-actions">
      {dirty?<><input aria-label="变更说明" className="grow" value={note} onChange={e=>setNote(e.target.value)} placeholder="变更说明（至少 4 个字）" maxLength={200}/>
        <button className="btn btn-primary" onClick={()=>void save()} disabled={busy||note.trim().length<4||invalidThresholds.length>0}>{busy&&<Spinner/>}保存为新版本</button>
        <button className="btn btn-ghost" onClick={()=>setDrafts({})} disabled={busy}>撤销修改</button></>
        :<span className="actions-note">无修改 · 历史版本：{data.versions.map(v=>v.version).join('、')}</span>}
    </div>
  </div>;
}
