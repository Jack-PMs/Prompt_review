import { db, getActivePrompt, getModel, getSetting, listScenes } from './db';
import { hasProviderKey } from './providers';
import { visionModelStatus } from './vision';
import { decisionRoleStatus } from './decision/models';
import { getActiveIntentConfig, getIntentCandidateModel } from './intent-engine';
import { activePolicy, reviewDb, taskView, type TaskRow } from './review/store';
import { DEFAULT_RULES } from './review/policy';
import type { RunRecord } from './types';

const DAY = 86_400_000;
/** Minimum benchmark samples before a version/model pair is considered evaluated. */
export const MIN_BENCHMARK_SAMPLES = 30;

export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a,b)=>a-b);
  return sorted[Math.max(0,Math.ceil(p*sorted.length)-1)];
}

function since(days: number) { return new Date(Date.now()-days*DAY).toISOString(); }

type LiveRow = Pick<RunRecord,'entry'|'status'|'intent_status'|'total_ms'|'attempts'|'error_code'> & {failover_from:string|null};

/** A request "produced a prompt" when the user got something usable: enhanced or fallback. */
function produced(row: LiveRow) { return row.status==='success' && (row.intent_status==='enhanced' || row.intent_status==='fallback'); }

function summarize(rows: LiveRow[]) {
  const ok = rows.filter(produced);
  const enhanced = rows.filter(r=>r.status==='success'&&r.intent_status==='enhanced');
  return {
    total: rows.length,
    produced_rate: rows.length ? ok.length/rows.length : null,
    p50_ms: percentile(enhanced.map(r=>r.total_ms),0.5),
    p95_ms: percentile(enhanced.map(r=>r.total_ms),0.95),
  };
}

export function liveStats(days = 7) {
  const rows = db().prepare("SELECT entry,status,intent_status,total_ms,attempts,error_code,failover_from FROM runs WHERE kind='live' AND created_at>=?")
    .all(since(days)) as LiveRow[];
  const outcomes = {
    enhanced: rows.filter(r=>r.status==='success'&&r.intent_status==='enhanced').length,
    fallback: rows.filter(r=>r.status==='success'&&r.intent_status==='fallback').length,
    needs_revision: rows.filter(r=>r.status==='needs_revision').length,
    needs_clarification: rows.filter(r=>r.intent_status==='needs_clarification').length,
    failed: rows.filter(r=>r.status==='failed').length,
  };
  const errorCounts = new Map<string,number>();
  for (const row of rows) if (row.error_code) errorCounts.set(row.error_code,(errorCounts.get(row.error_code)||0)+1);
  const modelCalled = rows.filter(r=>r.attempts>0);
  const sceneNames = new Map(listScenes().map(s=>[s.id,s.name]));
  const entries = [...new Set(rows.map(r=>r.entry))];
  const feedback = db().prepare(`SELECT COUNT(*) AS total,
      COALESCE(SUM(action='accepted'),0) AS accepted, COALESCE(SUM(action='edited'),0) AS edited, COALESCE(SUM(action='rejected'),0) AS rejected
      FROM feedback WHERE created_at>=?`).get(since(days)) as {total:number;accepted:number;edited:number;rejected:number};
  return {
    days,
    ...summarize(rows),
    outcomes,
    retry_rate: modelCalled.length ? modelCalled.filter(r=>r.attempts>1).length/modelCalled.length : null,
    failovers: rows.filter(r=>r.failover_from).length,
    errors: [...errorCounts].map(([code,count])=>({code,count})).sort((a,b)=>b.count-a.count).slice(0,5),
    feedback: {...feedback, adoption_rate: feedback.total ? (feedback.accepted+feedback.edited)/feedback.total : null},
    scenes: entries.map(entry=>({entry,name:entry?sceneNames.get(entry)||entry:'未指定',...summarize(rows.filter(r=>r.entry===entry))}))
      .sort((a,b)=>b.total-a.total),
  };
}

type BenchRow = Pick<RunRecord,'model_id'|'prompt_version'|'status'|'total_ms'|'input_tokens'|'output_tokens'>;

/** Benchmark stats over the last 30 days grouped by model and prompt version. */
export function benchmarkStats(version?: number) {
  const rows = (version === undefined
    ? db().prepare("SELECT model_id,prompt_version,status,total_ms,input_tokens,output_tokens FROM runs WHERE kind='benchmark' AND created_at>=?").all(since(30))
    : db().prepare("SELECT model_id,prompt_version,status,total_ms,input_tokens,output_tokens FROM runs WHERE kind='benchmark' AND created_at>=? AND prompt_version=?").all(since(30),version)) as BenchRow[];
  const groups = new Map<string,BenchRow[]>();
  for (const row of rows) {
    const key = `${row.model_id}:${row.prompt_version}`;
    groups.set(key,[...(groups.get(key)||[]),row]);
  }
  return [...groups.values()].map(group=>{
    const ok = group.filter(r=>r.status==='success');
    const avg = (pick:(r:BenchRow)=>number|null) => ok.length ? Math.round(ok.reduce((n,r)=>n+(pick(r)||0),0)/ok.length) : null;
    return {model_id:group[0].model_id,prompt_version:group[0].prompt_version,samples:group.length,success_rate:ok.length/group.length,
      p50_ms:percentile(ok.map(r=>r.total_ms),0.5),p95_ms:percentile(ok.map(r=>r.total_ms),0.95),
      avg_input_tokens:avg(r=>r.input_tokens),avg_output_tokens:avg(r=>r.output_tokens)};
  }).sort((a,b)=>b.prompt_version-a.prompt_version || (a.p50_ms??Infinity)-(b.p50_ms??Infinity));
}

/** Per prompt version: benchmark samples and success rate across all models (last 30 days). */
export function versionBenchmarks() {
  return db().prepare("SELECT prompt_version AS version, COUNT(*) AS samples, AVG(status='success') AS success_rate FROM runs WHERE kind='benchmark' AND created_at>=? GROUP BY prompt_version")
    .all(since(30)) as Array<{version:number;samples:number;success_rate:number}>;
}

type CheckLevel = 'ok'|'warn'|'fail';
export interface ReadinessCheck { key:string; label:string; level:CheckLevel; detail:string }

function modelReady(id: string) {
  const model = id ? getModel(id) : undefined;
  return {model, ready: Boolean(model?.enabled && hasProviderKey(model.provider))};
}

/** Checks computed from live configuration and data; nothing here is static text. */
export function readinessChecks(): ReadinessCheck[] {
  const checks: ReadinessCheck[] = [];
  const push = (key:string,label:string,level:CheckLevel,detail:string) => checks.push({key,label,level,detail});
  const apiKey = (process.env.ENHANCE_API_KEY||'').length >= 16;
  push('api_key','网站调用密钥',apiKey?'ok':'fail',apiKey?'ENHANCE_API_KEY 已配置':'ENHANCE_API_KEY 未配置或少于 16 字符，线上接口返回 503');
  const activeId = getSetting('active_model_id');
  const active = modelReady(activeId);
  push('model','默认强化模型',active.ready?'ok':'fail',active.ready?`${activeId} 可用`:`${activeId} 未启用或缺少密钥`);
  const backupId = getSetting('backup_model_id');
  const backup = modelReady(backupId);
  push('backup','备用强化模型',!backupId?'warn':backup.ready?'ok':'fail',
    !backupId?'未设置，默认强化模型渠道故障时请求直接失败':backup.ready?`${backupId} 可用`:`${backupId} 未启用或缺少密钥`);
  const vision = visionModelStatus();
  push('vision','参考图视觉描述模型',vision.primary_available?'ok':vision.available?'warn':'fail',
    vision.primary_available?`${vision.id} 可用`:vision.available?`${vision.id} 不可用，由备用 ${vision.active_id} 辅助识图`:`${vision.id||'未设置'} 不可用（多模态强化模型仍可原生看图）`);
  const { version: intentVer, config: intentCfg } = getActiveIntentConfig();
  const intentPrimary = getIntentCandidateModel(intentCfg.text_channel.primary_model_id);
  const intentBackup = intentCfg.text_channel.backup_model_id ? getIntentCandidateModel(intentCfg.text_channel.backup_model_id) : undefined;
  push('intent','意图识别',!intentCfg.enabled?'warn':intentPrimary?.key_configured?'ok':intentBackup?.key_configured?'warn':'fail',
    !intentCfg.enabled?'已关闭（当前走本地路由规则）':intentPrimary?.key_configured?`V${intentVer} · 主 ${intentPrimary.name}`:intentBackup?.key_configured?`主模型缺密钥，由备用 ${intentBackup.name} 接管`:'主备意图模型均缺少密钥');
  const version = getActivePrompt().version;
  const bench = benchmarkStats(version).find(s=>s.model_id===activeId);
  const samples = bench?.samples || 0;
  push('benchmark',`V${version} 基准样本`,samples>=MIN_BENCHMARK_SAMPLES?'ok':'warn',
    `默认模型在生效版本下 ${samples} 条（建议 ≥${MIN_BENCHMARK_SAMPLES}）`);
  if (bench && samples >= MIN_BENCHMARK_SAMPLES) {
    const rate = Math.round(bench.success_rate*100);
    push('success',`V${version} 基准成功率`,rate>=95?'ok':'warn',`默认模型 ${rate}%（建议 ≥95%）`);
  }
  const scenes = listScenes().filter(s=>s.enabled);
  const unconfigured = scenes.filter(s=>!s.rules.trim());
  push('scenes','使用场景',unconfigured.length?'warn':'ok',unconfigured.length
    ? `${unconfigured.length}/${scenes.length} 个启用场景未配置强化规则：${unconfigured.map(s=>s.name).join('、')}`
    : `${scenes.length} 个启用场景均已配置`);
  const feedbackCount = (db().prepare('SELECT COUNT(*) AS n FROM feedback WHERE created_at>=?').get(since(7)) as {n:number}).n;
  push('feedback','采纳反馈',feedbackCount?'ok':'warn',feedbackCount?`近 7 天 ${feedbackCount} 条`:'近 7 天没有反馈，网站尚未接入反馈接口或无人使用');
  return checks;
}

/**
 * 审核首页看板统计：汇总 review_tasks 中每次审核的耗时、放行/拦截占比、耗时分布区间、高频命中规则及最近审核任务列表。
 */
export function reviewDashboardStats(limit = 50) {
  const conn = reviewDb();
  const rows = conn.prepare('SELECT * FROM review_tasks ORDER BY created_at DESC LIMIT ?').all(limit) as TaskRow[];
  const allRows = conn.prepare('SELECT id,provider_mode,model,policy_version,execution_status,action,reason_codes,latency_ms,created_at FROM review_tasks ORDER BY created_at DESC').all() as Array<Pick<TaskRow,'id'|'provider_mode'|'model'|'policy_version'|'execution_status'|'action'|'reason_codes'|'latency_ms'|'created_at'>>;

  const completed = allRows.filter(r => r.execution_status === 'COMPLETE' && typeof r.latency_ms === 'number' && r.latency_ms >= 0);
  const liveCompleted = completed.filter(r => r.provider_mode === 'live');
  const latencySource = liveCompleted.length ? liveCompleted : completed;
  const latencies = latencySource.map(r => r.latency_ms as number);

  const avgMs = latencies.length ? Math.round(latencies.reduce((sum, v) => sum + v, 0) / latencies.length) : null;
  const minMs = latencies.length ? Math.min(...latencies) : null;
  const maxMs = latencies.length ? Math.max(...latencies) : null;
  const p50Ms = percentile(latencies, 0.5);
  const p95Ms = percentile(latencies, 0.95);

  const todayPrefix = new Date().toISOString().slice(0, 10);
  const todayCount = allRows.filter(r => r.created_at.startsWith(todayPrefix)).length;
  const allowCount = allRows.filter(r => r.execution_status === 'COMPLETE' && r.action === 'ALLOW').length;
  const blockCount = allRows.filter(r => r.execution_status === 'COMPLETE' && r.action === 'BLOCK').length;
  const failedCount = allRows.filter(r => r.execution_status === 'FAILED').length;
  const liveCount = allRows.filter(r => r.provider_mode === 'live').length;
  const mockCount = allRows.filter(r => r.provider_mode === 'mock').length;

  const buckets = [
    { label: '< 1s', count: latencies.filter(v => v < 1000).length, tone: 'success' as const },
    { label: '1s ~ 2s', count: latencies.filter(v => v >= 1000 && v < 2000).length, tone: 'info' as const },
    { label: '2s ~ 3s', count: latencies.filter(v => v >= 2000 && v < 3000).length, tone: 'info' as const },
    { label: '3s ~ 5s', count: latencies.filter(v => v >= 3000 && v < 5000).length, tone: 'warning' as const },
    { label: '≥ 5s', count: latencies.filter(v => v >= 5000).length, tone: 'danger' as const },
  ];

  const ruleTitles = new Map(DEFAULT_RULES.map(r => [r.rule_id, r.title]));
  const ruleHitMap = new Map<string, number>();
  for (const row of allRows) {
    let codes: string[] = [];
    try { codes = JSON.parse(row.reason_codes) as string[]; } catch { codes = []; }
    for (const code of codes) {
      if (code.startsWith('RULE_BLOCK:')) {
        const ruleId = code.slice('RULE_BLOCK:'.length);
        ruleHitMap.set(ruleId, (ruleHitMap.get(ruleId) || 0) + 1);
      }
    }
  }
  const ruleHits = [...ruleHitMap.entries()]
    .map(([rule_id, count]) => ({ rule_id, title: ruleTitles.get(rule_id) || rule_id, count }))
    .sort((a, b) => b.count - a.count);

  const modelMap = new Map<string, number[]>();
  for (const row of completed) {
    const key = row.provider_mode === 'mock' ? '模拟模式 (mock)' : (row.model || '未知模型');
    modelMap.set(key, [...(modelMap.get(key) || []), row.latency_ms as number]);
  }
  const modelStats = [...modelMap.entries()].map(([model, vals]) => ({
    model,
    count: vals.length,
    avg_ms: Math.round(vals.reduce((s, v) => s + v, 0) / vals.length),
    p50_ms: percentile(vals, 0.5),
    p95_ms: percentile(vals, 0.95),
    min_ms: Math.min(...vals),
    max_ms: Math.max(...vals),
  })).sort((a, b) => b.count - a.count);

  const policy = activePolicy();
  const decisionModel = decisionRoleStatus('review');

  return {
    total: allRows.length,
    today_count: todayCount,
    live_count: liveCount,
    mock_count: mockCount,
    allow_count: allowCount,
    block_count: blockCount,
    failed_count: failedCount,
    allow_rate: (allowCount + blockCount) > 0 ? allowCount / (allowCount + blockCount) : null,
    avg_ms: avgMs,
    p50_ms: p50Ms,
    p95_ms: p95Ms,
    min_ms: minMs,
    max_ms: maxMs,
    latency_sample_mode: liveCompleted.length ? 'live' : 'all',
    active_policy_version: policy.version,
    active_decision_model: decisionModel.label,
    buckets,
    rule_hits: ruleHits,
    model_stats: modelStats,
    recent_tasks: rows.map(taskView),
  };
}
