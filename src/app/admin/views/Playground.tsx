'use client';

import { useState } from 'react';
import { api, errorMessage, formatModelLabel, modelLabelById, ms, type ConsoleData, type Model, type TestResult } from '../lib';
import { Alert, Badge, Card, EmptyState, Field, Icon, Spinner } from '../ui';
import { fileToImage, type RefImage } from '../images';

const cases = [
  {name:'商品文生图',text:'米色亚麻抱枕，放在客厅沙发上，不要文字'},
  {name:'极简短词',text:'🌸床单'},
  {name:'纯数字艺术字',text:'111111111'},
  {name:'排除约束',text:'蓝白小碎花四件套，不要人物，不要文字'},
  {name:'无缝花型',text:'法式田园蓝白小雏菊无缝循环平铺图案，用于四件套面料印花'},
  {name:'真人模特',text:'年轻亚洲女模特身穿香槟色真丝睡衣坐在阳光卧室床边'},
];

type Mode = 'single'|'all'|'all3';
const modeLabels: Record<Mode,string> = {single:'所选模型',all:'对比全部可用模型',all3:'全部可用模型 × 3 次（看稳定性）'};
const roleLabels = {'':'不指定',content:'内容参考',style:'风格参考',composition:'构图参考'} as const;
type Role = keyof typeof roleLabels;
const MAX_IMAGES = 3;

export default function Playground({data,refresh}:{data:ConsoleData;refresh:()=>Promise<void>}) {
  const {config,prompts,scenes} = data;
  const [text,setText] = useState(cases[0].text);
  const [modelId,setModelId] = useState(config.active_model_id);
  const [version,setVersion] = useState(prompts.active_version);
  const [scene,setScene] = useState('');
  const [entry,setEntry] = useState('');
  const [refRole,setRefRole] = useState<Role>('');
  const [images,setImages] = useState<RefImage[]>([]);
  const [imageUrl,setImageUrl] = useState('');
  const [imageError,setImageError] = useState('');
  const [mode,setMode] = useState<Mode>('single');
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [results,setResults] = useState<TestResult[]>([]);

  const ready = config.models.filter(m=>m.enabled&&m.key_configured);
  const selectedReady = ready.some(m=>m.id===modelId);
  // Mirrors the website request: only non-empty fields are sent.
  const context = Object.fromEntries(Object.entries({entry,scene,reference_role:refRole,
    reference_images:images.length?images.map(image=>image.src):''}).filter(([,value])=>value!==''));
  async function addFiles(files: FileList|null) {
    if (!files?.length) return;
    setImageError('');
    const room = MAX_IMAGES-images.length;
    if (files.length>room) setImageError(`最多 ${MAX_IMAGES} 张，已忽略多余的图片`);
    try { const added = await Promise.all([...files].slice(0,room).map(fileToImage)); setImages(old=>[...old,...added].slice(0,MAX_IMAGES)); }
    catch(cause) { setImageError(errorMessage(cause,'图片读取失败')); }
  }
  function addUrl() {
    const url = imageUrl.trim();
    if (!/^https?:\/\/\S+$/.test(url)) { setImageError('请输入 http(s) 开头的图片链接'); return; }
    if (images.length>=MAX_IMAGES) { setImageError(`最多 ${MAX_IMAGES} 张`); return; }
    setImages(old=>[...old,{src:url,label:url}]); setImageUrl(''); setImageError('');
  }
  const blocker = (mode==='single'&&!selectedReady) ? '所选模型未启用或缺少密钥。'
    : (mode==='all'||mode==='all3')&&!ready.length ? '没有已启用且配置了密钥的模型。' : '';

  async function run() {
    setBusy(true);setError('');setResults([]);
    try {
      const ids = mode==='single' ? [modelId] : ready.map(m=>m.id);
      const repeats = mode==='all3' ? 3 : 1;
      const items: TestResult[] = [];
      for (let repeat=0;repeat<repeats;repeat++) for (const id of ids) {
        try {
          const response = await api<{request_id:string;result:Record<string,unknown>;metrics:Record<string,unknown>}>('/api/admin/playground',{method:'POST',body:JSON.stringify({text,context,model_id:id,prompt_version:version,kind:'playground'})});
          items.push({model:id,requestId:response.request_id,result:response.result,metrics:response.metrics});
        } catch(cause) { items.push({model:id,error:errorMessage(cause,'测试失败')}); }
        setResults([...items]);
      }
      void refresh();
    } catch(cause) { setError(errorMessage(cause,'运行失败')); }
    finally { setBusy(false); }
  }

  return <div className="page">
    <div className="split">
      <div className="split-main stack">
        <Card title="输入" description="同一输入、同一提示词版本下比较模型">
          <div className="chips" role="group" aria-label="示例输入">{cases.map(item=><button key={item.name} type="button" className={text===item.text?'chip active':'chip'} onClick={()=>setText(item.text)}>{item.name}</button>)}</div>
          <Field label="用户原始输入" htmlFor="pg-text" aside={`${text.length} / 2000`}><textarea id="pg-text" rows={4} value={text} onChange={e=>setText(e.target.value)} maxLength={2000}/></Field>
          <div className="field">
            <div className="field-label"><span className="label">参考图</span><span className="field-aside">{images.length} / {MAX_IMAGES} · reference_images</span></div>
            <div className="ref-grid">
              {images.map((image,index)=><figure className="ref-thumb" key={`${index}-${image.label}`}>
                {/* eslint-disable-next-line @next/next/no-img-element -- local previews and arbitrary remote URLs */}
                <img src={image.src} alt={`参考图 ${index+1}`}/>
                <figcaption title={image.label}>{image.label}</figcaption>
                <button type="button" className="ref-remove" onClick={()=>setImages(old=>old.filter((_,i)=>i!==index))} aria-label={`移除参考图 ${index+1}`}><Icon name="close" size={14}/></button>
              </figure>)}
              {images.length<MAX_IMAGES&&<label className="ref-add"><input type="file" className="sr-only" accept="image/png,image/jpeg,image/webp,image/gif" multiple onChange={e=>{void addFiles(e.target.files);e.target.value='';}}/><Icon name="plus" size={18}/><span>上传图片</span></label>}
            </div>
            {images.length<MAX_IMAGES&&<div className="ref-url"><input aria-label="参考图链接" value={imageUrl} onChange={e=>setImageUrl(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();addUrl();}}} placeholder="或粘贴图片链接 https://…"/><button type="button" className="btn btn-secondary" onClick={addUrl} disabled={!imageUrl.trim()}>添加</button></div>}
            {imageError?<p className="field-error" role="alert">{imageError}</p>:<p className="field-hint">上传的图片会在浏览器内压缩到 1600px 以内；图片只用于本次识别，不会保存。</p>}
          </div>
          {images.length>0&&<Field label="参考图用途" htmlFor="pg-role" hint="reference_role，决定识图时关注主体、风格还是构图"><select id="pg-role" value={refRole} onChange={e=>setRefRole(e.target.value as Role)}>{(Object.keys(roleLabels) as Role[]).map(key=><option key={key} value={key}>{key===''?'不指定（按内容参考）':roleLabels[key]}</option>)}</select></Field>}
          <div className="form-row two">
            <Field label="使用场景" htmlFor="pg-entry" hint="context.entry"><select id="pg-entry" value={entry} onChange={e=>setEntry(e.target.value)}><option value="">不指定</option>{scenes.filter(s=>s.enabled).map(s=><option key={s.id} value={s.id}>{s.name}（{s.id}）</option>)}</select></Field>
            <Field label="业务描述" htmlFor="pg-scene" hint="context.scene（选填，不填则完全按原文强化）"><input id="pg-scene" value={scene} onChange={e=>setScene(e.target.value)} placeholder="选填，如：家纺电商图" maxLength={100}/></Field>
          </div>
          <div className="form-row">
            <Field label="强化模型" htmlFor="pg-model"><select id="pg-model" value={modelId} onChange={e=>setModelId(e.target.value)}>{config.models.map(m=><option key={m.id} value={m.id}>{formatModelLabel(m)}{!m.enabled?' · 已停用':!m.key_configured?' · 缺少密钥':''}</option>)}</select></Field>
            <Field label="提示词版本" htmlFor="pg-version"><select id="pg-version" value={version} onChange={e=>setVersion(Number(e.target.value))}>{prompts.versions.map(p=><option key={p.version} value={p.version}>V{p.version}{p.version===prompts.active_version?'（生效中）':''} · {p.note}</option>)}</select></Field>
            <Field label="运行方式" htmlFor="pg-mode"><select id="pg-mode" value={mode} onChange={e=>setMode(e.target.value as Mode)}>{(Object.keys(modeLabels) as Mode[]).map(key=><option key={key} value={key}>{modeLabels[key]}</option>)}</select></Field>
          </div>
          {blocker&&<Alert tone="warning">{blocker}</Alert>}
          {error&&<Alert tone="danger">{error}</Alert>}
          <div className="actions"><button className="btn btn-primary" onClick={()=>void run()} disabled={busy||Boolean(blocker)||!text.trim()}>{busy?<Spinner/>:<Icon name="play" size={15}/>}{busy?'运行中…':'运行'}</button>
            <span className="actions-note">调用真实模型，结果计入调用记录</span></div>
        </Card>
      </div>

      <div className="split-side">
        <Card title="结果" description={results.length?`${results.length} 条`:undefined} className="sticky">
          {results.length?<div className="results">{results.map((item,index)=><ResultItem item={item} models={config.models} key={`${item.model}-${index}`}/>)}</div>
            :<EmptyState title={busy?'正在调用模型…':'还没有结果'}>{busy?'结果会逐条出现在这里。':'选好输入和模型后点击「运行」。'}</EmptyState>}
        </Card>
      </div>
    </div>
  </div>;
}

type IntentView = {
  status:'ok'|'failed';error?:string;
  channel?:string;model_id?:string;input_state?:string;action?:string;action_label?:string;routed_scene_id?:string|null;entry_conflict?:string|null;
  has_visual_intent:number|null;too_vague:number|null;
  category:{value:string;probability:number}|null;usage:{value:string;probability:number}|null;
  wants_rendered_text:number|boolean|null;has_exclusions:number|boolean|null;
};

const yesNo = (p: number|boolean|null|undefined) => p===null||p===undefined ? '—' : typeof p==='boolean' ? (p?'是':'否') : `${p>=0.5?'是':'否'}（${Math.round(p*100)}%）`;
const pick = (c: {value:string;probability:number}|null) => c ? `${c.value}（${Math.round(c.probability*100)}%）` : '—';
const chLabel: Record<string,string> = {rule_fast:'本地快筛',text_fast:'纯文本极速',vision_ondemand:'按需看图',fallback_rule:'降级规则'};

/** Structured intent recognition block shown in Playground results (routing only, zero blocking). */
function IntentBlock({intent,ms:elapsed}:{intent:IntentView;ms:number}) {
  if (intent.status!=='ok') return <div className="intent intent-failed"><span>意图识别降级 · {ms(elapsed)}</span><p>{intent.error||'未知错误'}，已自动退回本地规则保障可用。</p></div>;
  return <div className="intent"><span>意图识别 · {chLabel[intent.channel||'']||'模型路由'}{intent.model_id?` (${intent.model_id})`:''} · {ms(elapsed)}</span>
    <dl>
      <div><dt>创作动作</dt><dd>{intent.action_label||pick(intent.usage)}</dd></div>
      <div><dt>路由模板</dt><dd>{intent.routed_scene_id||'通用强化'}</dd></div>
      <div><dt>识别品类</dt><dd>{pick(intent.category)}</dd></div>
      <div><dt>要画文字</dt><dd>{yesNo(intent.wants_rendered_text)}</dd></div>
      <div><dt>有排除项</dt><dd>{yesNo(intent.has_exclusions)}</dd></div>
    </dl>
  </div>;
}

function ResultItem({item,models}:{item:TestResult;models:Model[]}) {
  const [copied,setCopied] = useState(false);
  const assumptions = Array.isArray(item.result?.assumptions) ? item.result.assumptions as string[] : [];
  const enhanceCount = Number(item.metrics?.attempts||0);
  const prompt = String(item.result?.prompt||'');
  const analysis = typeof item.result?.reference_analysis==='string' ? item.result.reference_analysis : '';
  const imageCount = Number(item.metrics?.image_count||0);
  const intent = item.result?.intent as IntentView|undefined;
  const badge = item.error ? <Badge tone="danger">调用失败</Badge> : <Badge tone="success">正常强化</Badge>;
  async function copy() { await navigator.clipboard.writeText(prompt); setCopied(true); setTimeout(()=>setCopied(false),1500); }
  return <article className="result">
    <header className="result-head"><strong>{modelLabelById(item.model,models)}</strong>{badge}</header>
    {item.error?<Alert tone="danger">{item.error}</Alert>:<>
      {intent&&<IntentBlock intent={intent} ms={Number(item.metrics?.intent_ms||0)}/>}
      {analysis&&<div className="analysis"><span>参考图识别</span><p>{analysis}</p></div>}
      <div className="prompt-box"><pre>{prompt}</pre><button className="btn btn-ghost btn-sm copy" onClick={()=>void copy()} aria-label="复制提示词"><Icon name={copied?'ok':'copy'} size={14}/>{copied?'已复制':'复制'}</button></div>
      {item.result?.user_notice?<p className="result-note">{String(item.result.user_notice)}</p>:null}
      {assumptions.length>0&&<p className="result-note">假设：{assumptions.join('；')}</p>}
      <dl className="meta">
        <div><dt>总耗时</dt><dd className="num">{ms(Number(item.metrics?.total_ms||0))}</dd></div>
        <div><dt>强化</dt><dd className="num">{ms(Number(item.metrics?.upstream_ms||0))} · {enhanceCount} 次</dd></div>
        {imageCount>0&&<div><dt>参考图</dt><dd className="num">{imageCount} 张{Number(item.metrics?.vision_ms||0)>0?` · ${ms(Number(item.metrics?.vision_ms||0))}`:' · 原生看图'}</dd></div>}
        <div><dt>Token</dt><dd className="num">{String(item.metrics?.input_tokens??'—')} / {String(item.metrics?.output_tokens??'—')}</dd></div>
        {item.requestId&&<div className="wide"><dt>请求 ID</dt><dd><code>{item.requestId}</code></dd></div>}
      </dl>
    </>}
  </article>;
}
