import { audit, db, getSetting, setSetting } from '../db';
import { AppError } from '../validation';
import type { ApiCallLog } from './decisions';
import { DEFAULT_POLICY_VERSION, DEFAULT_RULES, defaultBlockMessage, resolveAbsoluteThreshold } from './policy';
import { COPYRIGHT_RULE_ID } from '../copyright';
import type { Check, ExecutionStatus, PolicyVersion, ProviderMode, ReviewAction, ReviewRule, ReviewUnit, Signal, ViolationLevel } from './types';

let ready = false;

/** Review tables live in the same SQLite file; created lazily so the enhancement service is untouched. */
export function reviewDb() {
  const conn = db();
  if (ready) return conn;
  conn.exec(`
    CREATE TABLE IF NOT EXISTS review_policy_versions (
      version TEXT PRIMARY KEY, rules_json TEXT NOT NULL, note TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS review_assets (
      id TEXT PRIMARY KEY, sha256 TEXT NOT NULL, mime TEXT NOT NULL, bytes INTEGER NOT NULL,
      width INTEGER, height INTEGER, path TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS review_tasks (
      id TEXT PRIMARY KEY, stage TEXT NOT NULL, provider_mode TEXT NOT NULL, model TEXT, policy_version TEXT NOT NULL,
      execution_status TEXT NOT NULL, action TEXT NOT NULL, violation_level TEXT NOT NULL DEFAULT 'NONE', reason_codes TEXT NOT NULL DEFAULT '[]', topics TEXT NOT NULL DEFAULT '[]',
      prompt TEXT NOT NULL, prompt_hash TEXT NOT NULL, asset_ids TEXT NOT NULL DEFAULT '[]', content_hash TEXT NOT NULL,
      units TEXT NOT NULL DEFAULT '[]', checks TEXT NOT NULL DEFAULT '[]',
      generation_eligible INTEGER NOT NULL DEFAULT 0, is_demo INTEGER NOT NULL DEFAULT 0,
      revision INTEGER NOT NULL DEFAULT 0, decided_by TEXT, attempts INTEGER NOT NULL DEFAULT 0,
      latency_ms INTEGER, error TEXT, idempotency_key TEXT, request_hash TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS review_tasks_created_idx ON review_tasks(created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS review_tasks_idem_idx ON review_tasks(idempotency_key) WHERE idempotency_key IS NOT NULL;
    CREATE TABLE IF NOT EXISTS review_api_calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL REFERENCES review_tasks(id) ON DELETE CASCADE, unit_id TEXT NOT NULL, model_id TEXT,
      attempt INTEGER NOT NULL, sent INTEGER NOT NULL, method TEXT NOT NULL, url TEXT NOT NULL, request_headers TEXT NOT NULL, request_body TEXT NOT NULL,
      status INTEGER, response_body TEXT, latency_ms INTEGER NOT NULL, error TEXT, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS review_api_calls_task_idx ON review_api_calls(task_id, id);
    CREATE TABLE IF NOT EXISTS review_signals (
      task_id TEXT NOT NULL REFERENCES review_tasks(id) ON DELETE CASCADE, unit_id TEXT NOT NULL, rule_id TEXT NOT NULL,
      name TEXT NOT NULL, signal_status TEXT NOT NULL, probability REAL, PRIMARY KEY(task_id,unit_id,rule_id)
    );
  `);
  const callColumns = new Set((conn.pragma('table_info(review_api_calls)') as Array<{name:string}>).map(c=>c.name));
  if (!callColumns.has('model_id')) conn.exec('ALTER TABLE review_api_calls ADD COLUMN model_id TEXT');
  const taskColumns = new Set((conn.pragma('table_info(review_tasks)') as Array<{name:string}>).map(c=>c.name));
  if (!taskColumns.has('violation_level')) {
    conn.exec("ALTER TABLE review_tasks ADD COLUMN violation_level TEXT NOT NULL DEFAULT 'NONE'");
  }
  const now = new Date().toISOString();
  conn.prepare('INSERT OR IGNORE INTO review_policy_versions(version,rules_json,note,created_by,created_at) VALUES (?,?,?,?,?)')
    .run(DEFAULT_POLICY_VERSION,JSON.stringify(DEFAULT_RULES),'初始规则','system',now);
  if (!getSetting('review_active_policy')) setSetting('review_active_policy',DEFAULT_POLICY_VERSION);
  addChinaPoliticalRule(conn,now);
  addCopyrightRule(conn,now);
  revertUnderwearSuggestiveRule(conn);
  backfillViolationLevels(conn);
  ready = true;
  return conn;
}

/** 一次性回填历史拦截任务的违规等级（高确信风险或人工拦截归为 ABSOLUTE，其余拦截归为 POSSIBLE） */
function backfillViolationLevels(conn: ReturnType<typeof db>) {
  if (getSetting('review_violation_level_backfilled_v1')) return;
  conn.transaction(()=>{
    conn.prepare(`
      UPDATE review_tasks
      SET violation_level = CASE
        WHEN action != 'BLOCK' THEN 'NONE'
        WHEN reason_codes LIKE '%MANUAL_BLOCK%' OR reason_codes LIKE '%VIOLATION_ABSOLUTE%' THEN 'ABSOLUTE'
        WHEN EXISTS (
          SELECT 1 FROM review_signals s
          WHERE s.task_id = review_tasks.id
            AND s.rule_id NOT IN ('QUALITY-001', 'TOPIC-001')
            AND s.signal_status = 'SUCCESS'
            AND s.probability >= 0.95
        ) THEN 'ABSOLUTE'
        ELSE 'POSSIBLE'
      END
      WHERE violation_level = 'NONE' AND action = 'BLOCK'
    `).run();
    setSetting('review_violation_level_backfilled_v1','1');
  })();
}

/** Reverts SEX-001 and SEX-002 in the active policy back to the previous version and removes the temporary test tasks. */
function revertUnderwearSuggestiveRule(conn: ReturnType<typeof db>) {
  conn.transaction(()=>{
    if (getSetting('review_rule_underwear_reverted_v1')) return;
    const activeVer = getSetting('review_active_policy');
    const active = conn.prepare('SELECT rules_json FROM review_policy_versions WHERE version=?').get(activeVer) as {rules_json:string}|undefined;
    if (active) {
      const rules = (JSON.parse(active.rules_json) as StoredRule[]).map(normalizeRule);
      const sex001Preset = DEFAULT_RULES.find(r=>r.rule_id==='SEX-001')!;
      const sex002Preset = DEFAULT_RULES.find(r=>r.rule_id==='SEX-002')!;
      const updated = rules.map(rule => {
        if (rule.rule_id === 'SEX-001') {
          return {...rule, instructions:sex001Preset.instructions, exclusions:'', block_message:sex001Preset.block_message};
        }
        if (rule.rule_id === 'SEX-002') {
          return {...rule, instructions:sex002Preset.instructions, exclusions:'', block_message:sex002Preset.block_message};
        }
        return rule;
      });
      conn.prepare('UPDATE review_policy_versions SET rules_json=? WHERE version=?')
        .run(JSON.stringify(updated), activeVer);
    }
    conn.prepare("DELETE FROM review_tasks WHERE id IN ('rv_77b8348825794919a2e4','rv_0ac6c10ee88f4b7da1f3')").run();
    conn.prepare("DELETE FROM audit WHERE detail LIKE '优化 SEX-001/SEX-002%'").run();
    setSetting('review_rule_underwear_reverted_v1','1');
  })();
}

/** Add the new restriction to existing installations without rewriting their active or historical rules. */
function addCopyrightRule(conn: ReturnType<typeof db>, now: string) {
  conn.transaction(()=>{
    if (getSetting('review_rule_copyright_added')) return;
    const active = conn.prepare('SELECT rules_json FROM review_policy_versions WHERE version=?').get(getSetting('review_active_policy')) as {rules_json:string}|undefined;
    if (!active) throw new Error('ACTIVE_REVIEW_POLICY_MISSING');
    const rules = JSON.parse(active.rules_json) as ReviewRule[];
    if (!rules.some(rule=>rule.rule_id===COPYRIGHT_RULE_ID)) {
      rules.unshift(DEFAULT_RULES.find(rule=>rule.rule_id===COPYRIGHT_RULE_ID)!);
      const count = (conn.prepare('SELECT COUNT(*) AS n FROM review_policy_versions').get() as {n:number}).n;
      const version = `content-policy-v${count+1}`;
      const note = '新增规则：版权角色 / IP（钢铁侠、草莓熊等不放行）';
      conn.prepare('INSERT INTO review_policy_versions(version,rules_json,note,created_by,created_at) VALUES (?,?,?,?,?)')
        .run(version,JSON.stringify(rules),note,'system',now);
      setSetting('review_active_policy',version);
      audit('system','create','review_policy:'+version,note);
    }
    setSetting('review_rule_copyright_added','1');
  })();
}

/**
 * One-time migration: databases created before the 中国政治 rule get a new policy version that adds it
 * to the active rules. History is untouched; a marker prevents re-adding it if an operator later removes it.
 */
function addChinaPoliticalRule(conn: ReturnType<typeof db>, now: string) {
  if (getSetting('review_rule_cn_pol_added')) return;
  const active = conn.prepare('SELECT rules_json FROM review_policy_versions WHERE version=?').get(getSetting('review_active_policy')) as {rules_json:string}|undefined;
  const rule = DEFAULT_RULES.find(r=>r.rule_id==='CN-POL-001')!;
  if (active && !(JSON.parse(active.rules_json) as Array<{rule_id:string}>).some(r=>r.rule_id===rule.rule_id)) {
    const rules = JSON.parse(active.rules_json) as Array<{rule_id:string}>;
    const at = rules.findIndex(r=>r.rule_id==='ABUSE-001');
    rules.splice(at<0?rules.length:at,0,rule);
    const count = (conn.prepare('SELECT COUNT(*) AS n FROM review_policy_versions').get() as {n:number}).n;
    const version = `content-policy-v${count+1}`;
    conn.prepare('INSERT INTO review_policy_versions(version,rules_json,note,created_by,created_at) VALUES (?,?,?,?,?)')
      .run(version,JSON.stringify(rules),'新增规则：中国政治（涉及即拦截）','system',now);
    setSetting('review_active_policy',version);
    audit('system','create','review_policy:'+version,'新增规则 CN-POL-001 中国政治');
  }
  setSetting('review_rule_cn_pol_added','1');
}

type PolicyRow = Omit<PolicyVersion,'rules'> & {rules_json:string};
type StoredRule = ReviewRule & {review_threshold?:number|null;block_threshold?:number|null};
/** Versions saved before the single-threshold model used review/block thresholds; the lower one now blocks. */
function normalizeRule({review_threshold,block_threshold,...rule}: StoredRule): ReviewRule {
  const {auto_block:_a,calibration_status:_c,...rest} = rule as ReviewRule & {auto_block?:unknown;calibration_status?:unknown};
  const preset = DEFAULT_RULES.find(r=>r.rule_id===rest.rule_id);
  const threshold = rule.kind==='topic' ? null : rule.threshold ?? review_threshold ?? block_threshold ?? preset?.threshold ?? 0.5;
  const absolute_threshold = rule.kind==='risk'
    ? resolveAbsoluteThreshold({kind:rule.kind,threshold,absolute_threshold:rest.absolute_threshold})
    : null;
  const instructions = rest.exclusions?.trim() ? `${rest.instructions} 排除：${rest.exclusions}` : rest.instructions;
  const block_message = defaultBlockMessage(rest);
  return {...rest,instructions,exclusions:'',block_message,threshold,absolute_threshold};
}
const toPolicy = (row: PolicyRow): PolicyVersion => ({version:row.version,note:row.note,created_by:row.created_by,created_at:row.created_at,
  rules:(JSON.parse(row.rules_json) as StoredRule[]).map(normalizeRule)});

export function getPolicy(version: string): PolicyVersion|undefined {
  const row = reviewDb().prepare('SELECT * FROM review_policy_versions WHERE version=?').get(version) as PolicyRow|undefined;
  return row ? toPolicy(row) : undefined;
}
export function activePolicy(): PolicyVersion {
  reviewDb();
  const policy = getPolicy(getSetting('review_active_policy'));
  if (!policy) throw new Error('ACTIVE_REVIEW_POLICY_MISSING');
  return policy;
}
export function listPolicies(): PolicyVersion[] {
  return (reviewDb().prepare('SELECT * FROM review_policy_versions ORDER BY created_at DESC').all() as PolicyRow[]).map(toPolicy);
}

export interface TaskRow {
  id:string; stage:string; provider_mode:ProviderMode; model:string|null; policy_version:string;
  execution_status:ExecutionStatus; action:ReviewAction; violation_level?:ViolationLevel; reason_codes:string; topics:string;
  prompt:string; prompt_hash:string; asset_ids:string; content_hash:string; units:string; checks:string;
  generation_eligible:number; is_demo:number; revision:number; decided_by:string|null; attempts:number;
  latency_ms:number|null; error:string|null; idempotency_key:string|null; request_hash:string|null;
  created_at:string; updated_at:string;
}

export function getTask(id: string): TaskRow|undefined {
  return reviewDb().prepare('SELECT * FROM review_tasks WHERE id=?').get(id) as TaskRow|undefined;
}
export function taskSignals(id: string): Signal[] {
  return reviewDb().prepare('SELECT unit_id,rule_id,name,signal_status,probability FROM review_signals WHERE task_id=? ORDER BY unit_id,rule_id').all(id) as Signal[];
}
/** Stores one outbound request/response; the key is masked and image data replaced by a reference before this point. */
export function recordApiCall(taskId: string, entry: ApiCallLog) {
  reviewDb().prepare(`INSERT INTO review_api_calls(task_id,unit_id,model_id,attempt,sent,method,url,request_headers,request_body,status,response_body,latency_ms,error,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(taskId,entry.unit_id,entry.model_id,entry.attempt,entry.sent?1:0,entry.method,entry.url,JSON.stringify(entry.request_headers),
    JSON.stringify(entry.request_body),entry.status,entry.response_body,entry.latency_ms,entry.error,new Date().toISOString());
}

export function taskApiCalls(taskId: string) {
  const rows = reviewDb().prepare('SELECT * FROM review_api_calls WHERE task_id=? ORDER BY id').all(taskId) as Array<{id:number;unit_id:string;model_id:string|null;attempt:number;sent:number;method:string;url:string;
    request_headers:string;request_body:string;status:number|null;response_body:string|null;latency_ms:number;error:string|null;created_at:string}>;
  return rows.map(row=>({...row,sent:Boolean(row.sent),request_headers:JSON.parse(row.request_headers) as Record<string,string>,request_body:JSON.parse(row.request_body) as unknown}));
}

/** Combines one or more per-rule messages into a single natural sentence without awkward repetition. */
function formatCombinedBlockMessage(messages: string[], titles: string[]): string {
  if (messages.length === 0) return '';
  if (messages.length === 1) return messages[0];
  const cores = messages.map(msg => {
    const match = msg.match(/^该提示词可能(?:违反|涉及|包含)(.+?)(?:相关规范|规范)?[，,]\s*建议修改.*$/);
    return match ? match[1].trim() : null;
  });
  if (cores.every(Boolean)) {
    return `该提示词可能涉及${[...new Set(cores)].join('、')}，建议修改（可能影响生成结果）`;
  }
  if (titles.length > 1) {
    return `该提示词可能违反${titles.join('、')}相关规范，建议修改（可能影响生成结果）`;
  }
  return messages.join('；');
}

/** 将违规等级编码转换为中文展示标签 */
export function violationLevelLabel(level: ViolationLevel): string {
  if (level === 'ABSOLUTE') return '绝对违规';
  if (level === 'POSSIBLE') return '可能违规';
  return '正常';
}

/** 根据任务记录与理由码解析稳定的违规等级，向后兼容历史老记录 */
function resolveTaskViolationLevel(row: TaskRow, reasonCodes: string[]): ViolationLevel {
  if (row.action !== 'BLOCK') return 'NONE';
  if (row.violation_level === 'POSSIBLE' || row.violation_level === 'ABSOLUTE') {
    return row.violation_level;
  }
  if (reasonCodes.includes('VIOLATION_ABSOLUTE') || reasonCodes.includes('MANUAL_BLOCK')) {
    return 'ABSOLUTE';
  }
  return 'POSSIBLE';
}

/** Public view of a task (no file paths, no image data). */
export function taskView(row: TaskRow) {
  const reasonCodes = JSON.parse(row.reason_codes) as string[];
  const violationLevel = resolveTaskViolationLevel(row, reasonCodes);
  const policy = getPolicy(row.policy_version);
  const rules = policy?.rules ?? DEFAULT_RULES;
  const hitRules = reasonCodes
    .filter(code => code.startsWith('RULE_BLOCK:'))
    .map(code => {
      const ruleId = code.slice('RULE_BLOCK:'.length);
      return rules.find(item => item.rule_id === ruleId) ?? {rule_id:ruleId,title:ruleId,kind:'risk' as const,block_message:''};
    });
  const blockMessages = hitRules.map(rule => defaultBlockMessage(rule));
  const combinedMessage = formatCombinedBlockMessage(blockMessages, hitRules.map(r => r.title));
  const blockMessage = row.action === 'BLOCK'
    ? (combinedMessage || row.error || '提示词安全审核未完成，建议稍后重试')
    : null;
  return {
    task_id:row.id, stage:row.stage, provider_mode:row.provider_mode, model:row.model, policy_version:row.policy_version,
    execution_status:row.execution_status, action:row.action, violation_level:violationLevel, violation_label:violationLevelLabel(violationLevel),
    reason_codes:reasonCodes, topics:JSON.parse(row.topics) as string[],
    block_messages:blockMessages, block_message:blockMessage,
    prompt:row.prompt, asset_ids:JSON.parse(row.asset_ids) as string[], content_hash:row.content_hash,
    units:JSON.parse(row.units) as ReviewUnit[], checks:JSON.parse(row.checks) as Check[],
    generation_eligible:Boolean(row.generation_eligible), publish_eligible:false, is_demo:Boolean(row.is_demo),
    revision:row.revision, decided_by:row.decided_by, latency_ms:row.latency_ms, error:row.error,
    created_at:row.created_at, updated_at:row.updated_at,
  };
}

/**
 * 管理员人工复核改判（手动放行 ALLOW 或手动拦截 BLOCK）。
 * - 写入 decided_by 与审计日志，防止后续迟到的机器异步任务覆盖人工结论；
 * - 校验可选的 expectedRevision 乐观锁，避免多管理员并发覆盖；
 * - 保留原机器判定依据并记录 MANUAL_ALLOW / MANUAL_BLOCK 标记。
 */
export function overrideTaskAction(params: {
  id: string;
  action: 'ALLOW' | 'BLOCK';
  note?: string;
  actor?: string;
  expectedRevision?: number;
}): TaskRow {
  const actor = (params.actor || 'admin').trim() || 'admin';
  const note = (params.note || '').trim().slice(0, 200);
  const conn = reviewDb();
  return conn.transaction(() => {
    const existing = getTask(params.id);
    if (!existing) throw new AppError('NOT_FOUND', 404, '审核任务不存在');
    if (params.expectedRevision !== undefined && existing.revision !== params.expectedRevision) {
      throw new AppError('CONFIG_CONFLICT', 409, '该审核任务已被其他人更新，请刷新后重试');
    }
    const prevReasons = (JSON.parse(existing.reason_codes || '[]') as string[])
      .filter(code => code !== 'MANUAL_ALLOW' && code !== 'MANUAL_BLOCK');
    const manualCode = params.action === 'ALLOW' ? 'MANUAL_ALLOW' : 'MANUAL_BLOCK';
    const nextReasons = [...prevReasons, manualCode];
    const now = new Date().toISOString();
    const generationEligible = params.action === 'ALLOW' ? 1 : 0;
    const nextViolationLevel: ViolationLevel = params.action === 'ALLOW' ? 'NONE' : 'ABSOLUTE';

    const updated = conn.prepare(`
      UPDATE review_tasks
      SET execution_status='COMPLETE',
          action=?,
          violation_level=?,
          reason_codes=?,
          generation_eligible=?,
          decided_by=?,
          revision=revision+1,
          error=CASE WHEN ?='ALLOW' THEN NULL ELSE error END,
          updated_at=?
      WHERE id=? AND revision=?
    `).run(
      params.action,
      nextViolationLevel,
      JSON.stringify(nextReasons),
      generationEligible,
      actor,
      params.action,
      now,
      params.id,
      existing.revision,
    );
    if (!updated.changes) {
      throw new AppError('CONFIG_CONFLICT', 409, '该审核任务状态已变化，请刷新后重试');
    }

    const actionText = params.action === 'ALLOW' ? '手动放行' : '手动拦截';
    const detail = `${actionText}（原处置：${existing.action}）${note ? `，备注：${note}` : ''}`;
    audit(actor, 'override', `review_task:${params.id}`, detail);
    return getTask(params.id)!;
  })();
}
