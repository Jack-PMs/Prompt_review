'use client';

import { formatDate, type Audit } from '../lib';
import { Card, EmptyState } from '../ui';

const actionLabels: Record<string,string> = {create:'新建',update:'修改',activate:'发布',publish:'发布'};

/** Turns subjects like "scene:home" or "model:qwen-flash" into readable labels. */
function subjectLabel(subject:string) {
  const [type,id] = subject.split(':');
  const names: Record<string,string> = {scene:'场景',model:'模型',settings:'运行设置',prompt:'提示词',prompt_version:'提示词'};
  return id ? `${names[type]||type} ${id}` : names[type]||subject;
}

export default function AuditView({audit}:{audit:Audit}) {
  return <div className="page">
    <Card title="变更记录" description={`最近 ${audit.records.length} 条`} flush>
      {audit.records.length?<div className="table-wrap"><table className="table">
        <thead><tr><th>时间</th><th>操作人</th><th>动作</th><th>对象</th><th>内容</th></tr></thead>
        <tbody>{audit.records.map(r=><tr key={r.id}>
          <td className="nowrap num">{formatDate(r.created_at)}</td><td>{r.actor}</td><td>{actionLabels[r.action]||r.action}</td>
          <td className="nowrap">{subjectLabel(r.subject)}</td><td><span className="clamp" title={r.detail}>{r.detail||'—'}</span></td></tr>)}</tbody>
      </table></div>:<EmptyState title="暂无变更记录">修改模型、提示词、场景或运行设置后会记录在这里。</EmptyState>}
    </Card>
  </div>;
}
