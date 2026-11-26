'use client';

import { useState } from 'react';
import { api, errorMessage, formatModelLabel, providerLabels, type Config, type Model, type Tone } from '../lib';
import { Alert, Badge, Card, Spinner, Toggle, type ConfirmFn } from '../ui';
import DecisionModels from './DecisionModels';

type Draft = Pick<Model,'model'|'enabled'|'timeout_ms'|'max_output_tokens'>;

function validate(d: Draft): string {
  if (!/^[a-zA-Z0-9._:/-]{2,100}$/.test(d.model)) return '模型 ID 只能包含字母、数字和 . _ : / -';
  if (!Number.isInteger(d.timeout_ms) || d.timeout_ms<3000 || d.timeout_ms>60000) return '超时需为 3000～60000 ms';
  if (!Number.isInteger(d.max_output_tokens) || d.max_output_tokens<200 || d.max_output_tokens>4000) return '输出上限需为 200～4000';
  return '';
}

export default function ModelsView({config,refresh,notify,confirm}:{config:Config;refresh:()=>Promise<void>;notify:(message:string,tone?:Tone)=>void;confirm:ConfirmFn}) {
  const [drafts,setDrafts] = useState<Record<string,Draft>>({});
  const [busy,setBusy] = useState('');
  const [error,setError] = useState('');
  const draft = (m:Model):Draft => drafts[m.id] || {model:m.model,enabled:m.enabled,timeout_ms:m.timeout_ms,max_output_tokens:m.max_output_tokens};
  const change = (m:Model,patch:Partial<Draft>) => setDrafts(old=>({...old,[m.id]:{...draft(m),...patch}}));
  const isDirty = (m:Model) => { const d=draft(m); return d.model!==m.model||d.enabled!==m.enabled||d.timeout_ms!==m.timeout_ms||d.max_output_tokens!==m.max_output_tokens; };
  const reset = (id:string) => setDrafts(old=>{const next={...old};delete next[id];return next;});
  const roles = (id:string) => [id===config.active_model_id&&'默认强化模型',id===config.backup_model_id&&'备用模型',id===config.vision_model_id&&'识图模型'].filter(Boolean) as string[];

  async function save(m:Model) {
    const d = draft(m);
    if (m.enabled && !d.enabled && roles(m.id).length) {
      const ok = await confirm({title:`停用 ${formatModelLabel(m)}？`,confirmLabel:'停用',danger:true,
        body:<p>它目前是{roles(m.id).join('、')}。停用后相关请求会改用备用模型；没有可用备用模型时会直接失败。</p>});
      if (!ok) return;
    }
    setBusy(m.id);setError('');
    try {
      await api(`/api/admin/models/${m.id}`,{method:'PATCH',body:JSON.stringify({...d,enabled:Boolean(d.enabled),updated_at:m.updated_at})});
      reset(m.id); await refresh(); notify(`${formatModelLabel(m)} 已保存`);
    } catch(cause) { setError(`${formatModelLabel(m)}：${errorMessage(cause,'保存失败')}`); }
    finally { setBusy(''); }
  }

  return <div className="page">
    {error&&<Alert tone="danger">{error}</Alert>}
    <Card title="生成模型" description="提示词强化与参考图描述使用的生成模型。密钥只从服务端环境变量读取，这里仅显示变量名与是否已配置；改密钥后需重启服务。" flush>
      <div className="table-wrap"><table className="table table-form">
        <thead><tr><th>模型</th><th>调用的模型 ID</th><th>密钥</th><th>启用</th><th className="r">超时（ms）</th><th className="r">输出上限</th><th className="r"><span className="sr-only">操作</span></th></tr></thead>
        <tbody>{config.models.map(m=>{const d=draft(m);const dirty=isDirty(m);const invalid=dirty?validate(d):'';return <tr key={m.id} className={dirty?'row-dirty':undefined}>
          <td><span className="cell-main">{m.model}</span><span className="cell-sub">{providerLabels[m.provider]||m.provider} · {m.id}</span>{roles(m.id).map(r=><Badge key={r} tone="info" icon={false}>{r.replace('模型','')}</Badge>)}</td>
          <td><input aria-label={`${m.id} 调用的模型 ID`} value={d.model} onChange={e=>change(m,{model:e.target.value.trim()})}/></td>
          <td>{m.key_configured?<Badge tone="success">已配置</Badge>:<Badge tone="danger">未配置</Badge>}<code className="cell-sub">{m.key_env}</code></td>
          <td><Toggle checked={Boolean(d.enabled)} onChange={value=>change(m,{enabled:Number(value)})} label={`启用 ${m.id}`}/></td>
          <td className="r"><input className="num narrow" type="number" aria-label={`${m.id} 超时`} min={3000} max={60000} step={1000} value={d.timeout_ms} onChange={e=>change(m,{timeout_ms:Number(e.target.value)})}/></td>
          <td className="r"><input className="num narrow" type="number" aria-label={`${m.id} 输出上限`} min={200} max={4000} step={100} value={d.max_output_tokens} onChange={e=>change(m,{max_output_tokens:Number(e.target.value)})}/></td>
          <td className="r nowrap">{dirty?<>
            <button className="btn btn-primary btn-sm" onClick={()=>void save(m)} disabled={busy!==''||Boolean(invalid)} title={invalid||undefined}>{busy===m.id&&<Spinner/>}保存</button>
            <button className="btn btn-ghost btn-sm" onClick={()=>reset(m.id)} disabled={busy!==''}>撤销</button>
            {invalid&&<span className="field-error inline">{invalid}</span>}
          </>:<span className="muted-inline">无修改</span>}</td>
        </tr>;})}</tbody>
      </table></div>
    </Card>
    <DecisionModels notify={notify}/>
  </div>;
}
