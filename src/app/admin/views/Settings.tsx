'use client';

import { useState } from 'react';
import { api, errorMessage, formatModelLabel, type Config, type Tone } from '../lib';
import { Alert, Badge, Card, Field, Spinner } from '../ui';

export default function SettingsView({config,refresh,notify}:{config:Config;refresh:()=>Promise<void>;notify:(message:string,tone?:Tone)=>void}) {
  const [modelId,setModelId] = useState(config.active_model_id);
  const [backupId,setBackupId] = useState(config.backup_model_id);
  const [visionId,setVisionId] = useState(config.vision_model_id);
  const [visionBackupId,setVisionBackupId] = useState(config.vision_backup_model_id);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const enabled = config.models.filter(m=>m.enabled);
  const effectiveBackup = backupId===modelId ? '' : backupId;
  const effectiveVisionBackup = visionBackupId===visionId ? '' : visionBackupId;
  const dirty = modelId!==config.active_model_id || effectiveBackup!==config.backup_model_id
    || visionId!==config.vision_model_id || effectiveVisionBackup!==config.vision_backup_model_id;
  const vision = config.vision_model;

  async function save() {
    setBusy(true);setError('');
    try {
      await api('/api/admin/config',{method:'PUT',body:JSON.stringify({
        fallback_scene:config.fallback_scene,
        active_model_id:modelId,
        backup_model_id:effectiveBackup,
        vision_model_id:visionId,
        vision_backup_model_id:effectiveVisionBackup,
        intent_mode:config.intent_mode,
        decision_review_model_id:config.decision_review_model_id,
        decision_intent_model_id:config.decision_intent_model_id,
        decision_backup_model_id:config.decision_backup_model_id,
        revision:config.revision,
      })});
      await refresh(); notify('运行设置已保存');
    } catch(cause) { setError(errorMessage(cause,'保存失败')); }
    finally { setBusy(false); }
  }

  return <div className="page">
    <div className="stack narrow">
        <Card title="模型" description="线上请求使用的强化模型">
          <div className="form-row two">
            <Field label="默认强化模型" htmlFor="set-model" hint="只能选已启用的模型">
              <select id="set-model" value={modelId} onChange={e=>setModelId(e.target.value)}>{enabled.map(m=><option key={m.id} value={m.id}>{formatModelLabel(m)}{!m.key_configured?' · 缺少密钥':''}</option>)}</select></Field>
            <Field label="备用模型" htmlFor="set-backup" hint="默认模型超时、报错、限流或缺少密钥时，线上请求改用它重试一次">
              <select id="set-backup" value={effectiveBackup} onChange={e=>setBackupId(e.target.value)}><option value="">不使用</option>{enabled.filter(m=>m.id!==modelId).map(m=><option key={m.id} value={m.id}>{formatModelLabel(m)}{!m.key_configured?' · 缺少密钥':''}</option>)}</select></Field>
          </div>
        </Card>
        <Card title="用户意图识别与分流路由" description="独立意图识别中心（支持纯文本极速/按需看图双通道、创作动作路由绑定与版本一键回滚）"
          actions={<a href="#intent" className="btn btn-secondary btn-sm">前往「意图配置」管理 →</a>}>
          <p className="field-hint" style={{margin:0}}>提示词强化的前置意图模型（主备容灾）、动作与品类词表、超时阈值及实时试跑监控均在左侧「调优 → 意图配置」中独立维护，仅做意图路由、不做任何拦截。</p>
        </Card>
        <Card title="参考图识别" description="仅当所选强化模型不支持原生看图时，由识图模型先提取画面视觉描述再交给强化模型；多模态强化模型默认直接看图"
          actions={vision.primary_available?<Badge tone="success">可用</Badge>:vision.available?<Badge tone="warning">由备用识图</Badge>:<Badge tone="danger">不可用</Badge>}>
          <div className="form-row two">
            <Field label="识图模型" htmlFor="set-vision" hint="必须是能看图的模型；已验证 qwen3.8-flash、gemini-3.5-flash-lite">
              <select id="set-vision" value={visionId} onChange={e=>setVisionId(e.target.value)}>{enabled.map(m=><option key={m.id} value={m.id}>{formatModelLabel(m)}{!m.key_configured?' · 缺少密钥':''}</option>)}</select></Field>
            <Field label="识图备用模型" htmlFor="set-vision-backup" hint="建议选不同渠道的模型">
              <select id="set-vision-backup" value={effectiveVisionBackup} onChange={e=>setVisionBackupId(e.target.value)}><option value="">不使用</option>{enabled.filter(m=>m.id!==visionId).map(m=><option key={m.id} value={m.id}>{formatModelLabel(m)}{!m.key_configured?' · 缺少密钥':''}</option>)}</select></Field>
          </div>
        </Card>
        {error&&<Alert tone="danger">{error}</Alert>}
        <div className="actions sticky-actions">
          <button className="btn btn-primary" onClick={()=>void save()} disabled={busy||!dirty}>{busy&&<Spinner/>}保存设置</button>
          {dirty?<button className="btn btn-ghost" onClick={()=>{setModelId(config.active_model_id);setBackupId(config.backup_model_id);setVisionId(config.vision_model_id);setVisionBackupId(config.vision_backup_model_id);}} disabled={busy}>撤销修改</button>
            :<span className="actions-note">无修改</span>}
        </div>
    </div>
  </div>;
}
