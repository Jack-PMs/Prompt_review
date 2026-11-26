'use client';

import { useState } from 'react';
import { api, errorMessage, formatDate, pct, type Prompts, type Tab, type Tone } from '../lib';
import { Alert, Badge, Card, Field, Spinner, type ConfirmFn } from '../ui';

export default function PromptsView({prompts,refresh,notify,confirm,go}:{prompts:Prompts;refresh:()=>Promise<void>;notify:(message:string,tone?:Tone)=>void;confirm:ConfirmFn;go:(tab:Tab)=>void}) {
  const [selected,setSelected] = useState(prompts.active_version);
  const current = prompts.versions.find(p=>p.version===selected) || prompts.versions[0];
  const [body,setBody] = useState(current?.body||'');
  const [note,setNote] = useState('');
  const [busy,setBusy] = useState<'save'|'publish'|null>(null);
  const [error,setError] = useState('');
  const latest = prompts.versions[0]?.version || 1;
  const dirty = body !== current?.body;
  const bench = (version:number) => prompts.benchmarks.find(b=>b.version===version);
  const benchText = (version:number) => { const b=bench(version); return b?`基准 ${b.samples} 条 · 成功率 ${pct(b.success_rate)}`:'无基准数据'; };
  const tested = (version:number) => (bench(version)?.samples||0) >= prompts.min_benchmark_samples;
  const bodyError = body.trim().length<100 ? '正文至少 100 字符' : body.length>12000 ? '正文最多 12000 字符' : '';

  async function choose(version:number) {
    if (version===selected) return;
    if (dirty && !await confirm({title:'放弃未保存的修改？',body:<p>V{selected} 的编辑内容尚未保存为新版本，切换后会丢失。</p>,confirmLabel:'放弃修改',danger:true})) return;
    const next = prompts.versions.find(p=>p.version===version);
    if (next) { setSelected(version); setBody(next.body); setNote(''); setError(''); }
  }

  async function save() {
    setBusy('save');setError('');
    try {
      const data = await api<{version:number}>('/api/admin/prompt-versions',{method:'POST',body:JSON.stringify({body,note,latest_version:latest})});
      await refresh();
      setSelected(data.version); setNote('');
      notify(`已保存为 V${data.version}，评测后再发布`);
    } catch(cause) { setError(errorMessage(cause,'保存失败')); }
    finally { setBusy(null); }
  }

  async function publish() {
    const ok = await confirm({title:`发布 V${selected}？`,confirmLabel:'发布',
      body:<><p>发布后，线上所有强化请求立即改用 V{selected}（当前生效 V{prompts.active_version}）。可随时重新发布旧版本回滚。</p>
        {!tested(selected)&&<Alert tone="warning">V{selected} {benchText(selected)}，少于 {prompts.min_benchmark_samples} 条，效果未经充分评测。</Alert>}</>});
    if (!ok) return;
    setBusy('publish');setError('');
    try {
      await api(`/api/admin/prompt-versions/${selected}/activation`,{method:'POST',body:JSON.stringify({expected_active_version:prompts.active_version})});
      await refresh();
      notify(`V${selected} 已生效`);
    } catch(cause) { setError(errorMessage(cause,'发布失败')); }
    finally { setBusy(null); }
  }

  return <div className="page">
    <div className="master-detail">
      <Card title="版本" description={`共 ${prompts.versions.length} 个`} flush className="md-list">
        <ul className="list" role="listbox" aria-label="提示词版本">{prompts.versions.map(p=><li key={p.version}>
          <button type="button" role="option" aria-selected={p.version===selected} className={p.version===selected?'list-item active':'list-item'} onClick={()=>void choose(p.version)}>
            <span className="list-title"><strong>V{p.version}</strong>{p.version===prompts.active_version&&<Badge tone="success">生效中</Badge>}</span>
            <span className="list-sub">{p.note}</span>
            <span className="list-meta">{benchText(p.version)} · {formatDate(p.created_at)}</span>
          </button></li>)}</ul>
      </Card>

      {current&&<Card className="md-detail"
        title={<>V{current.version}{current.version===prompts.active_version?<Badge tone="success">生效中</Badge>:null}{dirty&&<Badge tone="warning">有未保存修改</Badge>}</>}
        description={`${current.note} · ${current.created_by} · ${formatDate(current.created_at)} · ${benchText(current.version)}`}
        actions={<>
          <button className="btn btn-secondary btn-sm" onClick={()=>go('playground')}>去评测</button>
          {current.version!==prompts.active_version&&<button className="btn btn-primary btn-sm" onClick={()=>void publish()} disabled={busy!==null||dirty}>{busy==='publish'&&<Spinner/>}发布此版本</button>}
        </>}>
        {error&&<Alert tone="danger">{error}</Alert>}
        <Field label="提示词正文" htmlFor="prompt-body" aside={`${body.length.toLocaleString('zh-CN')} / 12,000`} error={dirty?bodyError:undefined}
          hint="修改不会覆盖当前版本，只能另存为新版本。">
          <textarea id="prompt-body" className="mono" rows={22} value={body} onChange={e=>setBody(e.target.value)} spellCheck={false}/>
        </Field>
        {dirty&&<div className="save-bar">
          <Field label="变更说明" htmlFor="prompt-note" hint="至少 4 个字，写清楚改了什么，例如：加强材质约束"><input id="prompt-note" value={note} onChange={e=>setNote(e.target.value)} maxLength={200}/></Field>
          <div className="actions">
            <button className="btn btn-primary" onClick={()=>void save()} disabled={busy!==null||Boolean(bodyError)||note.trim().length<4}>{busy==='save'&&<Spinner/>}保存为 V{latest+1}</button>
            <button className="btn btn-ghost" onClick={()=>{setBody(current.body);setNote('');}} disabled={busy!==null}>撤销修改</button>
          </div>
        </div>}
      </Card>}
    </div>
  </div>;
}
