'use client';

import { useState } from 'react';
import { api, errorMessage, type Scene, type Tone } from '../lib';
import { Alert, Badge, Card, EmptyState, Field, Icon, Spinner, Toggle } from '../ui';

type Draft = Pick<Scene,'name'|'rules'|'fallback_scene'|'enabled'>;
const toDraft = (s:Scene):Draft => ({name:s.name,rules:s.rules,fallback_scene:s.fallback_scene,enabled:s.enabled});

export default function ScenesView({scenes,refresh,notify}:{scenes:Scene[];refresh:()=>Promise<void>;notify:(message:string,tone?:Tone)=>void}) {
  const [selectedId,setSelectedId] = useState(scenes[0]?.id||'');
  const selected = scenes.find(s=>s.id===selectedId);
  const [draft,setDraft] = useState<Draft|null>(selected?toDraft(selected):null);
  const [creating,setCreating] = useState(false);
  const [newId,setNewId] = useState('');
  const [newName,setNewName] = useState('');
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const dirty = Boolean(selected&&draft&&(draft.name!==selected.name||draft.rules!==selected.rules||draft.enabled!==selected.enabled));
  const nameError = draft&&!draft.name.trim() ? '名称不能为空' : '';
  const idError = newId&&!/^[a-z0-9][a-z0-9-]{0,39}$/.test(newId) ? '只能用小写字母、数字和连字符，以字母或数字开头' : scenes.some(s=>s.id===newId) ? '标识已存在' : '';

  function select(id:string) {
    if (dirty && !window.confirm('当前场景有未保存的修改，确定放弃？')) return;
    const scene = scenes.find(s=>s.id===id);
    if (scene) { setSelectedId(id); setDraft(toDraft(scene)); setError(''); }
  }

  async function create() {
    setBusy(true);setError('');
    try {
      const data = await api<{scene:Scene}>('/api/admin/scenes',{method:'POST',body:JSON.stringify({id:newId,name:newName.trim()})});
      await refresh();
      setSelectedId(data.scene.id); setDraft(toDraft(data.scene));
      setCreating(false); setNewId(''); setNewName('');
      notify(`已添加场景 ${data.scene.name}，接着填写强化附加规则`);
    } catch(cause) { setError(errorMessage(cause,'添加失败')); }
    finally { setBusy(false); }
  }

  async function save() {
    if (!selected||!draft) return;
    setBusy(true);setError('');
    try {
      const data = await api<{scene:Scene}>(`/api/admin/scenes/${selected.id}`,{method:'PATCH',body:JSON.stringify({...draft,enabled:Boolean(draft.enabled),updated_at:selected.updated_at})});
      await refresh(); setDraft(toDraft(data.scene));
      notify(`场景 ${data.scene.name} 已保存`);
    } catch(cause) { setError(errorMessage(cause,'保存失败')); }
    finally { setBusy(false); }
  }

  return <div className="page">
    <div className="master-detail">
      <Card title="场景" description={`${scenes.filter(s=>s.enabled).length} 个启用 / 共 ${scenes.length} 个`} flush className="md-list"
        actions={!creating&&<button className="btn btn-secondary btn-sm" onClick={()=>setCreating(true)}><Icon name="plus" size={14}/>新增</button>}>
        {creating&&<div className="inline-form">
          <Field label="标识" htmlFor="scene-new-id" hint="接口 context.entry 的值，创建后不可修改" error={idError||undefined}><input id="scene-new-id" value={newId} onChange={e=>setNewId(e.target.value.trim().toLowerCase())} placeholder="ab-side" maxLength={40} autoFocus/></Field>
          <Field label="名称" htmlFor="scene-new-name"><input id="scene-new-name" value={newName} onChange={e=>setNewName(e.target.value)} placeholder="AB 面生图" maxLength={30}/></Field>
          <div className="actions"><button className="btn btn-primary btn-sm" onClick={()=>void create()} disabled={busy||!newId||Boolean(idError)||!newName.trim()}>{busy&&<Spinner/>}添加</button>
            <button className="btn btn-ghost btn-sm" onClick={()=>{setCreating(false);setNewId('');setNewName('');}}>取消</button></div>
        </div>}
        {scenes.length?<ul className="list" role="listbox" aria-label="使用场景">{scenes.map(s=>{const configured=Boolean(s.rules.trim());return <li key={s.id}>
          <button type="button" role="option" aria-selected={s.id===selectedId} className={s.id===selectedId?'list-item active':'list-item'} onClick={()=>select(s.id)}>
            <span className="list-title"><strong>{s.name}</strong>{!s.enabled?<Badge>已停用</Badge>:!configured&&<Badge tone="warning">未配置</Badge>}</span>
            <code className="list-sub">{s.id}</code>
          </button></li>;})}</ul>:<EmptyState title="还没有场景"/>}
      </Card>

      {selected&&draft?<Card className="md-detail"
        title={<>{selected.name}{dirty&&<Badge tone="warning">有未保存修改</Badge>}</>}
        description={<>网站调用时传 <code>{`"context": {"entry": "${selected.id}"}`}</code></>}
        actions={<label className="toggle-label" htmlFor="scene-enabled"><span>{draft.enabled?'已启用':'已停用'}</span><Toggle id="scene-enabled" checked={Boolean(draft.enabled)} onChange={v=>setDraft({...draft,enabled:Number(v)})} label="启用场景"/></label>}>
        {error&&<Alert tone="danger">{error}</Alert>}
        {!draft.enabled&&<Alert tone="warning">停用后，传入该标识的请求会返回 400 INVALID_SCENE。</Alert>}
        <Field label="名称" htmlFor="scene-name" error={nameError||undefined}><input id="scene-name" value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})} maxLength={30}/></Field>
        <Field label="附加规则" htmlFor="scene-rules" aside={`${draft.rules.length} / 1000`} hint="追加到系统提示词末尾，只影响强化细节方向，不改变输出格式。留空时仅按基础强化规则执行。">
          <textarea id="scene-rules" rows={9} value={draft.rules} onChange={e=>setDraft({...draft,rules:e.target.value})} maxLength={1000} placeholder={'例如：\n主体为真人模特穿着或使用家纺产品；\n人物着装完整，姿态自然。'}/></Field>
        <div className="actions">
          <button className="btn btn-primary" onClick={()=>void save()} disabled={busy||!dirty||Boolean(nameError)}>{busy&&<Spinner/>}保存</button>
          {dirty&&<button className="btn btn-ghost" onClick={()=>setDraft(toDraft(selected))} disabled={busy}>撤销修改</button>}
        </div>
      </Card>:<Card className="md-detail"><EmptyState title="选择左侧场景进行编辑"/></Card>}
    </div>
  </div>;
}
