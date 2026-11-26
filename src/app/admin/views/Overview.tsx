'use client';

import { useState } from 'react';
import { api, errorMessage, formatDate, ms, pct, type ConsoleData, type Tab } from '../lib';
import { ActionBadge, ModeBadge, reasonLabel, TaskApiCalls, TaskEvidence, TaskSummary, type ReviewDetail, type ReviewTask } from '../review/shared';
import { Alert, Badge, Card, Drawer, EmptyState, Icon, Spinner, Stat } from '../ui';

/** 根据耗时毫秒数返回对应的颜色类名 */
function latencyClass(value: number | null) {
  if (value === null) return '';
  if (value < 1000) return 'latency-fast';
  if (value < 2500) return 'latency-mid';
  if (value < 5000) return 'latency-slow';
  return 'latency-very-slow';
}

/** 根据耗时毫秒数返回进度条填充颜色类名 */
function latencyFillTone(value: number | null) {
  if (value === null) return 'tone-neutral';
  if (value < 1000) return 'tone-success';
  if (value < 2500) return 'tone-info';
  if (value < 5000) return 'tone-warning';
  return 'tone-danger';
}

/** 紧凑显示柱状图顶部的耗时标签 */
function shortMs(value: number | null) {
  if (value === null) return '—';
  if (value >= 1000) return `${(value / 1000).toFixed(1)}s`;
  return `${value}ms`;
}

export default function Overview({data,go}:{data:ConsoleData;go:(tab:Tab)=>void}) {
  const rv = data.overview.review_dashboard;
  const [actionFilter, setActionFilter] = useState<'all'|'ALLOW'|'BLOCK'>('all');
  const [modeFilter, setModeFilter] = useState<'all'|'live'|'mock'>('all');
  const [selectedTask, setSelectedTask] = useState<ReviewTask | null>(rv.recent_tasks[0] ?? null);
  const [detail, setDetail] = useState<ReviewDetail | null>(null);
  const [openingId, setOpeningId] = useState('');
  const [error, setError] = useState('');

  // 最近 30 次已完成且有耗时的审核任务（按时间正序从左到右展示走势）
  const chartTasks = [...rv.recent_tasks]
    .filter(t => typeof t.latency_ms === 'number' && t.latency_ms >= 0)
    .slice(0, 30)
    .reverse();
  const maxChartMs = Math.max(...chartTasks.map(t => t.latency_ms || 0), 1000);

  // 明细表筛选
  const filteredTasks = rv.recent_tasks.filter(t => {
    if (actionFilter !== 'all' && t.action !== actionFilter) return false;
    if (modeFilter !== 'all' && t.provider_mode !== modeFilter) return false;
    return true;
  });
  const maxTableMs = Math.max(...filteredTasks.map(t => t.latency_ms || 0), 1000);
  const totalLatencyCount = rv.buckets.reduce((sum, b) => sum + b.count, 0) || 1;
  const totalRuleHits = rv.rule_hits.reduce((sum, r) => sum + r.count, 0) || 1;

  async function openDetail(id: string) {
    setOpeningId(id);
    setError('');
    try {
      setDetail(await api<ReviewDetail>(`/api/review/tasks/${id}`));
    } catch (cause) {
      setError(errorMessage(cause, '读取审核详情失败'));
    } finally {
      setOpeningId('');
    }
  }

  return <div className="page">
    {/* 顶部 4 张核心指标卡片 */}
    <div className="stats">
      <Stat
        label="累计审核次数"
        value={rv.total.toLocaleString('zh-CN')}
        detail={`今日 ${rv.today_count} 次 · 真实 API ${rv.live_count} 次 · 模拟 ${rv.mock_count} 次`}
      />
      <Stat
        label={`平均审核耗时${rv.latency_sample_mode==='live'?'（真实 API）':''}`}
        value={ms(rv.avg_ms)}
        detail={`中位数 p50：${ms(rv.p50_ms)}`}
      />
      <Stat
        label="耗时分位与极值"
        value={`p95 ${ms(rv.p95_ms)}`}
        detail={`最快 ${ms(rv.min_ms)} · 最慢 ${ms(rv.max_ms)}`}
      />
      <Stat
        label="放行率 / 命中情况"
        value={pct(rv.allow_rate)}
        detail={`放行 ${rv.allow_count} 次 · 命中提示 ${rv.block_count} 次${rv.failed_count ? ` · 失败 ${rv.failed_count} 次` : ''}`}
      />
    </div>

    {error && <Alert tone="danger">{error}</Alert>}

    {/* 每次审核耗时走势图 */}
    <Card
      title="每次审核耗时走势"
      description={`最近 ${chartTasks.length} 次审核逐笔耗时（从左到右按时间先后排列，点击柱子可查看该次审核详情）`}
      actions={<button className="btn btn-secondary btn-sm" onClick={()=>go('review')}><Icon name="shield" size={14}/>去审核工作台</button>}
    >
      {chartTasks.length ? <div className="latency-chart-wrap">
        <div className="latency-legend">
          <div className="latency-legend-items">
            <span className="latency-legend-dot"><i style={{background:'#16a34a'}}/>放行（ALLOW）</span>
            <span className="latency-legend-dot"><i style={{background:'#ea580c'}}/>命中规则提示（BLOCK）</span>
          </div>
          <span>当前规则版本：<code>{rv.active_policy_version}</code> · 默认判定模型：{rv.active_decision_model}</span>
        </div>
        <div className="latency-bars" role="list" aria-label="最近审核耗时柱状图">
          {chartTasks.map((t, index) => {
            const ratio = Math.max(8, Math.round(((t.latency_ms || 0) / maxChartMs) * 100));
            const tone = t.execution_status === 'FAILED' ? 'tone-fail' : t.action === 'ALLOW' ? 'tone-allow' : 'tone-block';
            const isSelected = selectedTask?.task_id === t.task_id;
            return <button
              key={t.task_id}
              type="button"
              role="listitem"
              className={`latency-bar-btn${isSelected ? ' selected' : ''}`}
              onClick={() => setSelectedTask(t)}
              onDoubleClick={() => void openDetail(t.task_id)}
              title={`${formatDate(t.created_at)}\n耗时：${ms(t.latency_ms)}\n结果：${t.action === 'ALLOW' ? '放行' : '命中提示'}\n内容：${t.prompt || '（仅图片）'}`}
            >
              <span className="latency-bar-val">{shortMs(t.latency_ms)}</span>
              <span className={`latency-bar-col ${tone}`} style={{height:`${ratio}%`}}/>
              <span className="latency-bar-idx">#{index + 1}</span>
            </button>;
          })}
        </div>
        {selectedTask && <div className="latency-selected-card">
          <div className="latency-selected-main">
            <ActionBadge task={selectedTask}/>
            <ModeBadge mode={selectedTask.provider_mode} demo={selectedTask.is_demo}/>
            <strong className={latencyClass(selectedTask.latency_ms)}>{ms(selectedTask.latency_ms)}</strong>
            <span className="muted-inline">{formatDate(selectedTask.created_at)}</span>
            <span className="clip" title={selectedTask.prompt}>「{selectedTask.prompt || '（无文字提示词）'}」</span>
            {selectedTask.block_message && <span className="field-error">→ {selectedTask.block_message}</span>}
          </div>
          <button className="btn btn-secondary btn-sm" onClick={() => void openDetail(selectedTask.task_id)} disabled={openingId === selectedTask.task_id}>
            {openingId === selectedTask.task_id && <Spinner/>}查看完整详情
          </button>
        </div>}
      </div> : <EmptyState title="暂无审核耗时数据" action={<button className="btn btn-primary btn-sm" onClick={()=>go('review')}>去提交第一条审核</button>}>在「审核工作台」或三笙前端「通用生图」提交提示词后，这里会实时展示每次审核耗时走势。</EmptyState>}
    </Card>

    {/* 耗时区间分布 & 规则命中统计 */}
    <div className="grid-2">
      <Card title="耗时区间分布与模型表现" description="按单次审核总耗时分段统计">
        <ul className="bars">
          {rv.buckets.map(item => <li key={item.label}>
            <span className="bar-label">{item.label}</span>
            <span className="bar-track" aria-hidden="true">
              <span className={`bar-fill tone-${item.tone}`} style={{width:`${(item.count / totalLatencyCount) * 100}%`}}/>
            </span>
            <span className="bar-value num">{item.count}<small>{pct(rv.total ? item.count / totalLatencyCount : 0)}</small></span>
          </li>)}
        </ul>
        {rv.model_stats.length > 0 && <div className="table-wrap" style={{marginTop:12}}>
          <table className="table">
            <thead><tr><th>调用模型 / 模式</th><th className="r">次数</th><th className="r">平均</th><th className="r">p50</th><th className="r">p95</th><th className="r">最快 / 最慢</th></tr></thead>
            <tbody>{rv.model_stats.map(m => <tr key={m.model}>
              <td><span className="cell-main">{m.model}</span></td>
              <td className="r num">{m.count}</td>
              <td className="r num">{ms(m.avg_ms)}</td>
              <td className="r num">{ms(m.p50_ms)}</td>
              <td className="r num">{ms(m.p95_ms)}</td>
              <td className="r num">{ms(m.min_ms)} / {ms(m.max_ms)}</td>
            </tr>)}</tbody>
          </table>
        </div>}
      </Card>

      <Card
        title="规则命中分布"
        description="历史审核中触发风险提示的规则排行"
        actions={<button className="btn btn-ghost btn-sm" onClick={()=>go('review-rules')}>规则配置<Icon name="chevron" size={14}/></button>}
      >
        {rv.rule_hits.length ? <ul className="bars">
          {rv.rule_hits.map(item => <li key={item.rule_id}>
            <span className="bar-label">{item.title}</span>
            <span className="bar-track" aria-hidden="true">
              <span className="bar-fill tone-warning" style={{width:`${(item.count / totalRuleHits) * 100}%`}}/>
            </span>
            <span className="bar-value num">{item.count} 次<small>{pct(item.count / totalRuleHits)}</small></span>
          </li>)}
        </ul> : <EmptyState title="暂无命中拦截记录">所有已完成审核均放行通过。</EmptyState>}
      </Card>
    </div>

    {/* 每次审核耗时明细表 */}
    <Card
      title="每次审核耗时明细"
      description={`展示最近 ${filteredTasks.length} 条审核记录的耗时、判定结果与提示文案，点击任意行可查看逐条规则信号与原始 API 响应`}
      flush
    >
      <div className="toolbar">
        <div className="segmented" role="group" aria-label="判定结果筛选">
          {([['all','全部'],['ALLOW','放行'],['BLOCK','命中提示']] as const).map(([key,label]) =>
            <button key={key} type="button" aria-pressed={actionFilter===key} className={actionFilter===key?'active':''} onClick={()=>setActionFilter(key)}>{label}</button>
          )}
        </div>
        <div className="segmented" role="group" aria-label="调用模式筛选">
          {([['all','全部模式'],['live','仅真实 API'],['mock','仅模拟']] as const).map(([key,label]) =>
            <button key={key} type="button" aria-pressed={modeFilter===key} className={modeFilter===key?'active':''} onClick={()=>setModeFilter(key)}>{label}</button>
          )}
        </div>
      </div>

      {filteredTasks.length ? <div className="table-wrap">
        <table className="table table-hover dashboard-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>审核提示词内容</th>
              <th>判定结果</th>
              <th>命中规则 / 前端提示语</th>
              <th>判定模型</th>
              <th className="r">单次耗时</th>
              <th className="r"><span className="sr-only">操作</span></th>
            </tr>
          </thead>
          <tbody>
            {filteredTasks.map(t => {
              const barPct = t.latency_ms ? Math.min(100, Math.max(6, Math.round((t.latency_ms / maxTableMs) * 100))) : 0;
              const imgCount = t.units.filter(u => u.modality === 'image').length;
              return <tr key={t.task_id} onClick={() => void openDetail(t.task_id)}>
                <td className="nowrap num">{formatDate(t.created_at)}</td>
                <td>
                  <span className="cell-main clip" title={t.prompt}>{t.prompt || '（无文字提示词）'}</span>
                  {imgCount > 0 && <span className="cell-sub">含 {imgCount} 张参考图</span>}
                </td>
                <td className="nowrap">
                  <ActionBadge task={t}/>
                </td>
                <td>
                  {t.action === 'BLOCK' ? <>
                    <span className="cell-main clip" title={t.block_message || ''}>{t.block_message || t.reason_codes.map(reasonLabel).join('；')}</span>
                  </> : t.topics.length > 0 ? t.topics.map(tp => <Badge key={tp} tone="info" icon={false}>{tp}</Badge>) : <span className="muted-inline">正常通过</span>}
                </td>
                <td className="nowrap">
                  <span className="cell-main">{t.provider_mode === 'live' ? (t.model || '—') : '模拟模式'}</span>
                </td>
                <td className="r nowrap num">
                  <div className="latency-cell">
                    <span className="latency-mini-track" aria-hidden="true">
                      <span className={`latency-mini-fill bar-fill ${latencyFillTone(t.latency_ms)}`} style={{width:`${barPct}%`}}/>
                    </span>
                    <span className={latencyClass(t.latency_ms)}>{ms(t.latency_ms)}</span>
                  </div>
                </td>
                <td className="r nowrap">
                  <button className="btn btn-ghost btn-sm" onClick={e => { e.stopPropagation(); void openDetail(t.task_id); }}>
                    {openingId === t.task_id ? <Spinner/> : '详情'}
                  </button>
                </td>
              </tr>;
            })}
          </tbody>
        </table>
      </div> : <EmptyState title="没有符合筛选条件的审核记录">切换上方筛选条件或提交新的审核任务。</EmptyState>}
    </Card>

    <Drawer open={detail !== null} onClose={() => setDetail(null)} title="审核耗时与结果详情">
      {detail && <div className="stack">
        <TaskSummary task={detail}/>
        <TaskEvidence task={detail}/>
        <TaskApiCalls task={detail}/>
      </div>}
    </Drawer>
  </div>;
}
