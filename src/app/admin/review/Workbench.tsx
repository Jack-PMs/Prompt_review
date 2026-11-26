'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage, formatDate } from '../lib';
import { fileToImage, type RefImage } from '../images';
import { Alert, Badge, Card, EmptyState, Field, Icon, Spinner } from '../ui';
import { TaskApiCalls, TaskEvidence, TaskSummary, type ReviewDetail, type ReviewHealth } from './shared';

const MAX_IMAGES = 4;
const fixtures = [
  {label:'安全样本',text:'【演示】米色亚麻抱枕，放在客厅沙发上，柔和自然光'},
  {label:'涉政话题',text:'【演示】联合国大会会场的新闻插画，代表们在讨论气候政策'},
  {label:'擦边 → 拦截',text:'【演示】性感姿态的人物写真，强调身材曲线'},
  {label:'暴力煽动',text:'【演示】号召大家明天带上武器去袭击某个具体地点'},
];

export default function Workbench({health,refreshHealth,refreshConsole}:{health:ReviewHealth;refreshHealth:()=>Promise<void>;refreshConsole?:()=>Promise<void>}) {
  const [prompt,setPrompt] = useState('');
  const [images,setImages] = useState<RefImage[]>([]);
  const [imageError,setImageError] = useState('');
  const [modelId,setModelId] = useState(health.selected_model_id || health.models?.[0]?.id || 'openai-gpt-6-luna');
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [task,setTask] = useState<ReviewDetail|null>(null);
  const [checking,setChecking] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>|null>(null);

  useEffect(()=>{
    if (health.models?.length && !health.models.some(m=>m.id===modelId)) {
      setModelId(health.selected_model_id || health.models[0].id);
    }
  },[health.models,health.selected_model_id,modelId]);

  const poll = useCallback(async(id:string)=>{
    try {
      const detail = await api<ReviewDetail>(`/api/review/tasks/${id}`);
      setTask(detail);
      if (detail.execution_status==='PENDING'||detail.execution_status==='RUNNING') timer.current = setTimeout(()=>void poll(id),800);
      else { void refreshHealth(); void refreshConsole?.(); }
    } catch(cause) { setError(errorMessage(cause,'读取结果失败')); }
  },[refreshHealth,refreshConsole]);
  useEffect(()=>()=>{ if (timer.current) clearTimeout(timer.current); },[]);

  async function submit() {
    setBusy(true);setError('');setTask(null);
    try {
      const created = await api<{task_id:string}>('/api/review/tasks',{method:'POST',headers:{'idempotency-key':`ui-${crypto.randomUUID()}`},
        body:JSON.stringify({prompt,images:images.map(i=>i.src),model_id:modelId})});
      await poll(created.task_id);
    } catch(cause) { setError(errorMessage(cause,'提交失败')); }
    finally { setBusy(false); }
  }

  async function addFiles(files: FileList|null) {
    if (!files?.length) return;
    setImageError('');
    const room = MAX_IMAGES-images.length;
    if (files.length>room) setImageError(`最多 ${MAX_IMAGES} 张，已忽略多余的图片`);
    try { const added = await Promise.all([...files].slice(0,room).map(fileToImage)); setImages(old=>[...old,...added].slice(0,MAX_IMAGES)); }
    catch(cause) { setImageError(errorMessage(cause,'图片读取失败')); }
  }

  async function testConnection() {
    setChecking(true);
    try { await api('/api/review/health',{method:'POST',body:JSON.stringify({model_id:modelId})}); await refreshHealth(); }
    catch(cause) { setError(errorMessage(cause,'连接测试失败')); }
    finally { setChecking(false); }
  }

  async function selectModel(nextId: string) {
    setModelId(nextId);
  }

  const running = task && (task.execution_status==='PENDING'||task.execution_status==='RUNNING');
  const activeModelOption = health.models?.find(m=>m.id===modelId);
  const imageOnlyModel = activeModelOption?.supports_text === false;
  const textOnlyModel = activeModelOption && !activeModelOption.supports_images;
  const modalityMismatch = imageOnlyModel && !images.length
    ? '当前所选模型仅支持图片审核，不支持纯文本；请上传参考图，或切换支持文字的模型'
    : textOnlyModel && !prompt.trim() && images.length > 0
      ? '当前所选模型仅支持文字审核，不支持纯图片；请填写提示词，或切换支持图片的模型'
      : '';
  const modelCapabilityHint = imageOnlyModel
    ? (prompt.trim() ? '当前模型仅审参考图；填写的提示词将由文本判定模型分别审核' : '仅支持参考图审核（不支持纯文本）')
    : textOnlyModel && images.length > 0
      ? '当前模型仅支持文字，参考图将自动使用支持图片的模型审核'
      : activeModelOption?.supports_images
        ? '支持文字 + 参考图审核'
        : '仅支持文字审核';
  return <div className="page">
    <div className="split">
      <div className="split-main stack">
        <Card title="提交审核" description="审核生成前的有效提示词与参考图；支持图文模型将提示词与参考图合并为 1 次请求同时判定">
          {health.mode==='mock'&&<div className="chips" role="group" aria-label="演示样本">{fixtures.map(f=><button key={f.label} type="button" className={prompt===f.text?'chip active':'chip'} onClick={()=>setPrompt(f.text)}>{f.label}</button>)}</div>}
          {health.models && health.models.length>0 && (
            <Field label="判定模型" htmlFor="rv-model" aside={modelCapabilityHint}>
              <select id="rv-model" value={modelId} onChange={e=>void selectModel(e.target.value)} disabled={busy||Boolean(running)}>
                {health.models.map(m=>(
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </Field>
          )}
          <Field label="提示词" htmlFor="rv-prompt" aside={`${prompt.length} / 4000`}><textarea id="rv-prompt" rows={5} value={prompt} onChange={e=>setPrompt(e.target.value)} maxLength={4000} placeholder={imageOnlyModel?'当前所选模型仅支持图片审核；如需同时审核文字，将自动由文本判定模型处理':'粘贴最终用于生成的提示词'}/></Field>
          <div className="field">
            <div className="field-label"><span className="label">参考图</span><span className="field-aside">{images.length} / {MAX_IMAGES}</span></div>
            <div className="ref-grid">
              {images.map((image,index)=><figure className="ref-thumb" key={`${index}-${image.label}`}>
                {/* eslint-disable-next-line @next/next/no-img-element -- local preview */}
                <img src={image.src} alt={`参考图 ${index+1}`}/><figcaption title={image.label}>{image.label}</figcaption>
                <button type="button" className="ref-remove" onClick={()=>setImages(old=>old.filter((_,i)=>i!==index))} aria-label={`移除参考图 ${index+1}`}><Icon name="close" size={14}/></button>
              </figure>)}
              {images.length<MAX_IMAGES&&<label className="ref-add"><input type="file" className="sr-only" accept="image/png,image/jpeg,image/webp,image/gif" multiple onChange={e=>{void addFiles(e.target.files);e.target.value='';}}/><Icon name="plus" size={18}/><span>上传图片</span></label>}
            </div>
            {imageError&&<p className="field-error" role="alert">{imageError}</p>}
          </div>
          {health.config_error&&<Alert tone="danger">{health.config_error}</Alert>}
          {modalityMismatch&&<Alert tone="warning">{modalityMismatch}</Alert>}
          {error&&<Alert tone="danger">{error}</Alert>}
          <div className="actions"><button className="btn btn-primary" onClick={()=>void submit()} disabled={busy||Boolean(running)||(!prompt.trim()&&!images.length)||Boolean(health.config_error)||Boolean(modalityMismatch)}>{busy||running?<Spinner/>:<Icon name="play" size={15}/>}{running?'审核中…':'提交审核'}</button>
            <span className="actions-note">{health.mode==='mock'?'模拟模式只对上方演示样本返回模拟数据；其他内容未完成版权检查，暂不放行':`调用真实判定接口（${activeModelOption?.model||health.model}）`}</span></div>
        </Card>

        <Card title="判定服务" description="渠道兜底顺序与总超时上限在「模型与渠道」中统一配置" actions={<button className="btn btn-secondary btn-sm" onClick={()=>void testConnection()} disabled={checking||!health.key_configured}>{checking&&<Spinner/>}测试连接</button>}>
          <dl className="facts">
            <div><dt>运行模式</dt><dd>{health.mode==='live'?<Badge tone="info" icon={false}>真实 API</Badge>:<Badge icon={false}>模拟模式</Badge>}</dd></div>
            <div><dt>当前模型</dt><dd>{activeModelOption?.label || health.model}</dd></div>
            <div><dt>密钥</dt><dd>{health.key_configured?<Badge tone="success">已配置</Badge>:<Badge tone="danger">未配置</Badge>}</dd></div>
            <div><dt>最近连接测试</dt><dd>{health.last_check?<>{health.last_check.ok?<Badge tone="success">正常</Badge>:<Badge tone="danger">失败</Badge>}<span className="muted-inline">{health.last_check.latency_ms} ms · {formatDate(health.last_check.at)}</span></>:'尚未测试'}</dd></div>
            <div className="wide"><dt>兜底顺序</dt><dd>{health.models && health.models.length>0 ? health.models.map((m,i)=>`#${i+1} ${m.label}`).join(' → ') : health.model}</dd></div>
          </dl>
        </Card>
      </div>

      <div className="split-side">
        <Card title="审核结果">
          {task?<>{running?<div className="running"><Spinner/>正在判定审核内容…</div>:<TaskSummary task={task} onUpdated={setTask}/>}
            {!running&&<><TaskEvidence task={task}/><TaskApiCalls task={task}/></>}</>
            :<EmptyState title="还没有审核任务">填写提示词或上传图片后提交。</EmptyState>}
        </Card>
      </div>
    </div>
  </div>;
}
