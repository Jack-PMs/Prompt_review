'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage, formatDate } from '../lib';
import { Alert, Card, Drawer, EmptyState, Spinner } from '../ui';
import { ActionBadge, ModeBadge, TaskApiCalls, TaskEvidence, TaskSummary, type ReviewDetail, type ReviewTask } from './shared';

type RecordFilter = '' | 'ALLOW' | 'POSSIBLE' | 'ABSOLUTE' | 'BLOCK';

export default function Records() {
  const [tasks,setTasks] = useState<ReviewTask[]|null>(null);
  const [filter,setFilter] = useState<RecordFilter>('');
  const [status,setStatus] = useState('');
  const [error,setError] = useState('');
  const [detail,setDetail] = useState<ReviewDetail|null>(null);
  const [opening,setOpening] = useState('');
  const [releasingId,setReleasingId] = useState('');

  const load = useCallback(async()=>{
    try {
      const params: Record<string,string> = {};
      if (filter==='ALLOW') params.action = 'ALLOW';
      else if (filter==='BLOCK') params.action = 'BLOCK';
      else if (filter==='POSSIBLE') { params.action = 'BLOCK'; params.violation_level = 'POSSIBLE'; }
      else if (filter==='ABSOLUTE') { params.action = 'BLOCK'; params.violation_level = 'ABSOLUTE'; }
      if (status) params.status = status;
      const query = new URLSearchParams(params);
      setTasks((await api<{tasks:ReviewTask[]}>(`/api/review/tasks?${query}`)).tasks); setError('');
    } catch(cause) { setError(errorMessage(cause,'加载失败')); }
  },[filter,status]);
  useEffect(()=>{
    void load();
    const timer = setInterval(()=>{
      if (document.visibilityState === 'visible') void load();
    },3000);
    return ()=>clearInterval(timer);
  },[load]);

  async function open(id: string) {
    setOpening(id);
    try { setDetail(await api<ReviewDetail>(`/api/review/tasks/${id}`)); }
    catch(cause) { setError(errorMessage(cause,'读取详情失败')); }
    finally { setOpening(''); }
  }

  /** 在记录列表行直接一键手动放行已拦截的任务 */
  async function quickAllow(task: ReviewTask, event: React.MouseEvent) {
    event.stopPropagation();
    setReleasingId(task.task_id);
    setError('');
    try {
      const updated = await api<ReviewDetail>(`/api/review/tasks/${task.task_id}`,{
        method:'PATCH',
        body:JSON.stringify({action:'ALLOW',revision:task.revision}),
      });
      if (detail?.task_id === updated.task_id) setDetail(updated);
      await load();
    } catch (cause) {
      setError(errorMessage(cause,'手动放行失败'));
    } finally {
      setReleasingId('');
    }
  }

  function handleDetailUpdated(updated: ReviewDetail) {
    setDetail(updated);
    void load();
  }

  return <div className="page">
    <Card title="审核记录" description={tasks?`${tasks.length} 条`:undefined} flush>
      <div className="toolbar">
        <div className="segmented" role="group" aria-label="处置与违规等级">{([
          ['','全部'],
          ['ALLOW','通过'],
          ['POSSIBLE','可能违规'],
          ['ABSOLUTE','绝对违规'],
          ['BLOCK','全部拦截'],
        ] as Array<[RecordFilter,string]>).map(([key,label])=>
          <button key={key} type="button" aria-pressed={filter===key} className={filter===key?'active':''} onClick={()=>setFilter(key)}>{label}</button>)}</div>
        <label className="inline-select"><span>执行状态</span><select value={status} onChange={e=>setStatus(e.target.value)}>
          <option value="">全部</option><option value="PENDING">排队中</option><option value="RUNNING">审核中</option><option value="COMPLETE">已完成</option><option value="FAILED">失败</option></select></label>
      </div>
      {error&&<div className="card-pad"><Alert tone="danger">{error}</Alert></div>}
      {!tasks?<div className="card-pad"><Spinner/></div>:tasks.length?<div className="table-wrap"><table className="table table-hover">
        <thead><tr><th>时间</th><th>内容</th><th>处置</th><th>模式</th><th>规则版本</th><th>任务 ID</th><th className="r">操作</th></tr></thead>
        <tbody>{tasks.map(t=><tr key={t.task_id} onClick={()=>void open(t.task_id)}>
          <td className="num">{formatDate(t.created_at)}</td>
          <td><span className="cell-main clip">{t.prompt||'（无提示词）'}</span><span className="cell-sub">{t.units.filter(u=>u.modality==='image').length?`${t.units.filter(u=>u.modality==='image').length} 张图片`:'仅文字'}</span></td>
          <td><ActionBadge task={t}/>{opening===t.task_id&&<Spinner/>}</td>
          <td><ModeBadge mode={t.provider_mode} demo={t.is_demo}/></td>
          <td>{t.policy_version}</td>
          <td><code className="cell-sub">{t.task_id}</code></td>
          <td className="r nowrap">
            {t.action==='BLOCK' && t.execution_status!=='PENDING' && t.execution_status!=='RUNNING' ? (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={releasingId===t.task_id}
                onClick={e=>void quickAllow(t,e)}
              >
                {releasingId===t.task_id&&<Spinner/>}手动放行
              </button>
            ) : (
              <span className="muted-inline">{t.decided_by ? `已人工${t.action==='ALLOW'?'放行':'拦截'}` : '—'}</span>
            )}
          </td>
        </tr>)}</tbody></table></div>
        :<EmptyState title="没有符合条件的记录">在「审核工作台」提交后会出现在这里。</EmptyState>}
    </Card>
    <Drawer open={detail!==null} onClose={()=>setDetail(null)} title="审核详情">
      {detail&&<div className="stack"><TaskSummary task={detail} onUpdated={handleDetailUpdated}/><TaskEvidence task={detail}/><TaskApiCalls task={detail}/>
      </div>}
    </Drawer>
  </div>;
}
