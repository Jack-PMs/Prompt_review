'use client';

import { useMemo, useState } from 'react';
import { api, errorLabels, errorMessage, formatDate, kindLabels, modelLabelById, ms, pct, runOutcome, type Model, type Run, type Runs, type Scene } from '../lib';
import { Alert, Badge, Card, Drawer, EmptyState, Spinner } from '../ui';

const outcomeFilters = ['全部','正常强化','失败'];

export default function RunsView({runs,scenes,models:modelConfigs}:{runs:Runs;scenes:Scene[];models:Model[]}) {
  const [rows,setRows] = useState<Run[]>(runs.runs);
  const [limit,setLimit] = useState(runs.runs.length);
  const [kind,setKind] = useState('all');
  const [outcome,setOutcome] = useState('全部');
  const [model,setModel] = useState('all');
  const [detail,setDetail] = useState<Run|null>(null);
  const [loading,setLoading] = useState(false);
  const [error,setError] = useState('');
  const sceneName = (id:string|null) => id ? scenes.find(s=>s.id===id)?.name || id : '—';
  const modelName = (id:string|null|undefined) => modelLabelById(id,modelConfigs);
  const models = useMemo(()=>[...new Set(rows.map(r=>r.model_id))].sort(),[rows]);
  const filtered = rows.filter(r=>(kind==='all'||r.kind===kind)&&(outcome==='全部'||runOutcome(r).label===outcome)&&(model==='all'||r.model_id===model));

  async function loadMore() {
    setLoading(true);setError('');
    try { const data = await api<Runs>('/api/admin/runs?limit=200'); setRows(data.runs); setLimit(200); }
    catch(cause) { setError(errorMessage(cause,'加载失败')); }
    finally { setLoading(false); }
  }

  return <div className="page">
    <Card title="最近调用" description={`最近 ${rows.length} 条，筛选后 ${filtered.length} 条。线上请求不保存用户原文和输出。`} flush
      actions={limit<200&&<button className="btn btn-secondary btn-sm" onClick={()=>void loadMore()} disabled={loading}>{loading&&<Spinner/>}加载最近 200 条</button>}>
      <div className="toolbar">
        <div className="segmented" role="group" aria-label="调用类型">{[['all','全部'],['live','线上'],['playground','测试'],['benchmark','基准']].map(([key,label])=>
          <button key={key} type="button" aria-pressed={kind===key} className={kind===key?'active':''} onClick={()=>setKind(key)}>{label}</button>)}</div>
        <label className="inline-select"><span>结果</span><select value={outcome} onChange={e=>setOutcome(e.target.value)}>{outcomeFilters.map(o=><option key={o}>{o}</option>)}</select></label>
        <label className="inline-select"><span>模型</span><select value={model} onChange={e=>setModel(e.target.value)}><option value="all">全部</option>{models.map(m=><option key={m} value={m}>{modelName(m)}</option>)}</select></label>
      </div>
      {error&&<div className="card-pad"><Alert tone="danger">{error}</Alert></div>}
      {filtered.length?<div className="table-wrap"><table className="table table-hover">
        <thead><tr><th>时间</th><th>类型</th><th>场景</th><th>模型</th><th>版本</th><th>结果</th><th className="r">总耗时</th><th className="r">强化次数</th><th><span className="sr-only">操作</span></th></tr></thead>
        <tbody>{filtered.map(r=>{const o=runOutcome(r);return <tr key={r.id} onClick={()=>setDetail(r)}>
          <td className="nowrap num">{formatDate(r.created_at)}</td>
          <td>{kindLabels[r.kind]||r.kind}{r.image_count>0&&<span className="cell-sub">{r.image_count} 张参考图</span>}</td>
          <td>{sceneName(r.entry)}</td>
          <td><span className="cell-main">{modelName(r.model_id)}</span>{r.failover_from&&<span className="cell-sub">由 {modelName(r.failover_from)} 切换</span>}</td>
          <td className="num">V{r.prompt_version}</td>
          <td><Badge tone={o.tone}>{o.label}</Badge>{r.error_code&&<span className="cell-sub">{errorLabels[r.error_code]||r.error_code}</span>}</td>
          <td className="r num">{ms(r.total_ms)}</td>
          <td className="r num">{r.attempts}</td>
          <td className="r"><button className="btn btn-ghost btn-sm" onClick={e=>{e.stopPropagation();setDetail(r);}}>详情</button></td>
        </tr>;})}</tbody>
      </table></div>:<EmptyState title="没有符合条件的调用">调整上方筛选条件试试。</EmptyState>}
    </Card>

    <Card title="基准统计" description="最近 30 天的基准调用，按模型和提示词版本分组" flush>
      {runs.stats.length?<div className="table-wrap"><table className="table">
        <thead><tr><th>模型</th><th>版本</th><th className="r">样本</th><th className="r">成功率</th><th className="r">p50</th><th className="r">p95</th><th className="r">平均 Token（入 / 出）</th></tr></thead>
        <tbody>{runs.stats.map(s=><tr key={`${s.model_id}-${s.prompt_version}`}>
          <td>{modelName(s.model_id)}</td><td className="num">V{s.prompt_version}{s.prompt_version===runs.active_version&&<Badge tone="success" icon={false}>生效</Badge>}</td>
          <td className="r num">{s.samples}</td><td className="r num">{pct(s.success_rate)}</td><td className="r num">{ms(s.p50_ms)}</td><td className="r num">{ms(s.p95_ms)}</td>
          <td className="r num">{s.avg_input_tokens??'—'} / {s.avg_output_tokens??'—'}</td></tr>)}</tbody>
      </table></div>:<EmptyState title="暂无基准数据">在测试台运行基准后显示。</EmptyState>}
    </Card>

    <Drawer open={detail!==null} onClose={()=>setDetail(null)} title="调用详情">
      {detail&&<RunDetail run={detail} sceneName={sceneName(detail.entry)} modelName={modelName}/>}
    </Drawer>
  </div>;
}

function RunDetail({run,sceneName,modelName}:{run:Run;sceneName:string;modelName:(id:string|null|undefined)=>string}) {
  const o = runOutcome(run);
  let output: Record<string,unknown>|null = null;
  try { output = run.output_json ? JSON.parse(run.output_json) : null; } catch { output = null; }
  const rows: Array<[string,React.ReactNode]> = [
    ['结果',<Badge key="o" tone={o.tone}>{o.label}</Badge>],['错误',run.error_code?`${errorLabels[run.error_code]||''} ${run.error_code}`:'—'],
    ['时间',formatDate(run.created_at)],['类型',kindLabels[run.kind]||run.kind],['场景',sceneName],
    ['强化模型',run.failover_from?`${modelName(run.model_id)}（由 ${modelName(run.failover_from)} 切换）`:modelName(run.model_id)],['提示词版本',`V${run.prompt_version}`],
    ['总耗时',ms(run.total_ms)],['强化耗时',`${ms(run.upstream_ms)} · ${run.attempts} 次请求`],
    ['意图识别',run.intent_check?`${run.intent_check==='ok'?'成功':'失败，已按规则判断'} · ${ms(run.intent_ms)}`:'未运行'],
    ['参考图',run.image_count?`${run.image_count} 张 · 识图 ${ms(run.vision_ms)} · ${run.vision_model_id?modelName(run.vision_model_id):'原生看图'}`:'无'],
    ['Token（入 / 出）',`${run.input_tokens??'—'} / ${run.output_tokens??'—'}`],['请求 ID',<code key="id">{run.id}</code>],
  ];
  return <>
    <dl className="detail-list">{rows.map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
    <h3 className="detail-heading">输入</h3>
    {run.input_text?<pre className="code">{run.input_text}</pre>:<p className="muted-inline">{run.kind==='live'?'线上请求不保存用户原文。':'未保存输入。'}</p>}
    <h3 className="detail-heading">输出提示词</h3>
    {output&&typeof output.prompt==='string'&&output.prompt?<pre className="code">{output.prompt}</pre>:<p className="muted-inline">{run.kind==='live'?'线上请求不保存输出。':'无输出。'}</p>}
  </>;
}
