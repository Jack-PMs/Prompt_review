import { db, getSetting } from '../db';
import { getTencentCiHost, isTencentCiConfigured } from '../tencent/client';

/** Wire protocols supported by the decision client. Adding a vendor with a new format = one adapter in client.ts. */
export type DecisionProtocol =
  | 'openai-decisions'
  | 'google-decisions'
  | 'looprouter-systemone'
  | 'aliyun-systemone'
  | 'tencent-ci-review';

/**
 * Channel presets. Keys are only ever sent to these fixed hosts (the endpoint is never free text);
 * a new channel is one entry here. `{workspace}` is filled from the model row (not a secret).
 */
export const DECISION_CHANNELS = {
  looprouter:{label:'LoopRouter · Decisions（图文）',protocol:'openai-decisions',endpoint:'https://api.looprouter.com/v1/decisions',keyEnv:'LOOPROUTER_API_KEY',supportsText:true,supportsImages:true,maxQuestions:400},
  'looprouter-systemone':{label:'LoopRouter · System One（文本决策）',protocol:'looprouter-systemone',endpoint:'https://api.looprouter.com/v1/systemone',keyEnv:'LOOPROUTER_API_KEY',supportsText:true,supportsImages:false,maxQuestions:16},
  'looprouter-systemone-multimodal':{label:'LoopRouter · System One（多模态图文）',protocol:'looprouter-systemone',endpoint:'https://api.looprouter.com/v1/systemone',keyEnv:'LOOPROUTER_API_KEY',supportsText:true,supportsImages:true,maxQuestions:16},
  bananarouter:{label:'BananaRouter（中转 · Gemini）',protocol:'google-decisions',endpoint:'https://api.bananarouter.com/v1/decisions',keyEnv:'BANANA_ROUTER_API_KEY',supportsText:true,supportsImages:true,maxQuestions:1000},
  apiyi:{label:'API易（中转）',protocol:'openai-decisions',endpoint:'https://api.apiyi.com/v1/decisions',keyEnv:'APIYI_API_KEY',supportsText:true,supportsImages:true,maxQuestions:400},
  gemini:{label:'Google Gemini 直连',protocol:'google-decisions',endpoint:'https://generativelanguage.googleapis.com/v1beta/decisions',keyEnv:'GEMINI_API_KEY',supportsText:true,supportsImages:true,maxQuestions:1000},
  openai:{label:'OpenAI 直连',protocol:'openai-decisions',endpoint:'https://api.openai.com/v1/decisions',keyEnv:'OPENAI_API_KEY',supportsText:true,supportsImages:true,maxQuestions:400},
  'aliyun-beijing':{label:'阿里云百炼直连（北京）',protocol:'aliyun-systemone',endpoint:'https://{workspace}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/systemone',keyEnv:'DASHSCOPE_API_KEY',supportsText:true,supportsImages:false,maxQuestions:16},
  'aliyun-singapore':{label:'阿里云百炼直连（新加坡）',protocol:'aliyun-systemone',endpoint:'https://{workspace}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/systemone',keyEnv:'DASHSCOPE_API_KEY',supportsText:true,supportsImages:false,maxQuestions:16},
  'tencent-ci-review':{label:'腾讯云数据万象 CI · 内容审核（图文）',protocol:'tencent-ci-review',endpoint:'https://ci.myqcloud.com',keyEnv:'TENCENT_SECRET_ID',supportsText:true,supportsImages:true,maxQuestions:50},
} as const satisfies Record<string,{label:string;protocol:DecisionProtocol;endpoint:string;keyEnv:string;supportsText:boolean;supportsImages:boolean;maxQuestions:number}>;
export type DecisionChannelId = keyof typeof DECISION_CHANNELS;

export interface DecisionModel {
  id:string; channel:DecisionChannelId; model:string; workspace_id:string; enabled:number; timeout_ms:number; priority:number;
  /** JSON of the last connection test: {ok,at,latency_ms,message}. */
  last_test:string|null; updated_at:string;
}

export type DecisionRole = 'review'|'intent';

let ready = false;
export function decisionDb() {
  const conn = db();
  if (ready) return conn;
  conn.exec(`CREATE TABLE IF NOT EXISTS decision_models (
    id TEXT PRIMARY KEY, channel TEXT NOT NULL, model TEXT NOT NULL, workspace_id TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1, timeout_ms INTEGER NOT NULL DEFAULT 20000, priority INTEGER NOT NULL DEFAULT 100, last_test TEXT, updated_at TEXT NOT NULL)`);
  const cols = new Set((conn.pragma('table_info(decision_models)') as Array<{name:string}>).map(c=>c.name));
  if (!cols.has('priority')) {
    conn.exec('ALTER TABLE decision_models ADD COLUMN priority INTEGER NOT NULL DEFAULT 100');
  }
  const now = new Date().toISOString();
  const seed = conn.prepare('INSERT OR IGNORE INTO decision_models(id,channel,model,workspace_id,enabled,timeout_ms,priority,updated_at) VALUES (?,?,?,?,?,?,?,?)');
  // Keep the 3 LoopRouter decision models + OpenAI official channel model + Tencent Cloud review channels:
  seed.run('openai-gpt-6-luna','openai','gpt-6-luna','',1,6000,1,now);
  seed.run('looprouter-gpt-6-luna','looprouter',process.env.REVIEW_DECISIONS_MODEL?.trim()||'gpt-6-luna','',1,6000,2,now);
  seed.run('aliyun-decision-preview','looprouter-systemone','decision-model-preview','',1,4000,3,now);
  seed.run('looprouter-doubao-seed-2-1-lite','looprouter-systemone-multimodal','doubao-seed-2-1-lite-260915','',1,5000,4,now);
  // 腾讯云数据万象 CI 内容审核（统一支持文本同步审核 + 图片批量同步审核；CAM 授予 QcloudCIFullAccess 后在后台一键测试并启用）
  seed.run('tencent-ci-content-review','tencent-ci-review','ci-content-auditing','',0,10000,5,now);
  conn.prepare("DELETE FROM decision_models WHERE id NOT IN ('looprouter-gpt-6-luna','aliyun-decision-preview','looprouter-doubao-seed-2-1-lite','openai-gpt-6-luna','tencent-ci-content-review')").run();
  conn.prepare("UPDATE decision_models SET channel='looprouter-systemone', enabled=1, updated_at=? WHERE id='aliyun-decision-preview' AND channel!='looprouter-systemone'").run(now);
  // 豆包 Doubao Seed 2.1 Lite 已支持 System One 多模态图文决策，自动将存量记录升级为多模态渠道
  conn.prepare("UPDATE decision_models SET channel='looprouter-systemone-multimodal', updated_at=? WHERE id='looprouter-doubao-seed-2-1-lite' AND channel='looprouter-systemone'").run(now);
  const settings = conn.prepare('INSERT OR IGNORE INTO settings(key,value,updated_at) VALUES (?,?,?)');
  settings.run('decision_review_model_id','openai-gpt-6-luna',now);
  settings.run('decision_backup_model_id','looprouter-gpt-6-luna',now);
  settings.run('decision_intent_model_id','looprouter-gpt-6-luna',now);
  settings.run('review_total_timeout_ms','12000',now);
  if (!conn.prepare("SELECT 1 FROM settings WHERE key='decision_failover_v2'").get()) {
    conn.prepare("UPDATE decision_models SET timeout_ms=6000 WHERE id IN ('openai-gpt-6-luna','looprouter-gpt-6-luna') AND timeout_ms>=15000").run();
    conn.prepare("UPDATE decision_models SET timeout_ms=4000 WHERE id='aliyun-decision-preview' AND timeout_ms>=10000").run();
    conn.prepare("UPDATE decision_models SET timeout_ms=5000 WHERE id='looprouter-doubao-seed-2-1-lite' AND timeout_ms>=10000").run();
    conn.prepare("UPDATE decision_models SET priority=1 WHERE id='openai-gpt-6-luna'").run();
    conn.prepare("UPDATE decision_models SET priority=2 WHERE id='looprouter-gpt-6-luna'").run();
    conn.prepare("UPDATE decision_models SET priority=3 WHERE id='aliyun-decision-preview'").run();
    conn.prepare("UPDATE decision_models SET priority=4 WHERE id='looprouter-doubao-seed-2-1-lite'").run();
    conn.prepare("UPDATE settings SET value='openai-gpt-6-luna',updated_at=? WHERE key='decision_review_model_id'").run(now);
    conn.prepare("UPDATE settings SET value='looprouter-gpt-6-luna',updated_at=? WHERE key='decision_backup_model_id'").run(now);
    settings.run('decision_failover_v2','1',now);
  }
  ready = true;
  return conn;
}

export function listDecisionModels(): DecisionModel[] {
  return decisionDb().prepare('SELECT * FROM decision_models ORDER BY priority ASC, rowid ASC').all() as DecisionModel[];
}

export function reorderDecisionModels(orderedIds: string[]) {
  const conn = decisionDb();
  const current = listDecisionModels();
  const validIds = new Set(current.map(m => m.id));
  const merged = [
    ...orderedIds.filter(id => validIds.has(id)),
    ...current.map(m => m.id).filter(id => !orderedIds.includes(id)),
  ];
  const now = new Date().toISOString();
  conn.transaction(() => {
    const stmt = conn.prepare('UPDATE decision_models SET priority=?, updated_at=? WHERE id=?');
    merged.forEach((id, index) => {
      stmt.run(index + 1, now, id);
    });
    const enabledOrdered = merged.filter(id => {
      const m = getDecisionModel(id);
      return m && !unusableReason(m);
    });
    if (enabledOrdered[0]) {
      conn.prepare('INSERT INTO settings(key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at')
        .run('decision_review_model_id', enabledOrdered[0], now);
    }
    conn.prepare('INSERT INTO settings(key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at')
      .run('decision_backup_model_id', enabledOrdered[1] || '', now);
  })();
}
export function getDecisionModel(id: string): DecisionModel|undefined {
  return id ? decisionDb().prepare('SELECT * FROM decision_models WHERE id=?').get(id) as DecisionModel|undefined : undefined;
}

export function channelOf(model: DecisionModel) { return DECISION_CHANNELS[model.channel]; }
export function keyConfigured(model: DecisionModel) {
  const ch = channelOf(model);
  if (ch.protocol === 'tencent-ci-review') return isTencentCiConfigured();
  return Boolean(process.env[ch.keyEnv]?.trim());
}
/** Resolved endpoint, or null when a required workspace ID or CI bucket/region is missing/invalid. */
export function endpointOf(model: DecisionModel): string|null {
  const ch = channelOf(model);
  if (ch.protocol === 'tencent-ci-review') {
    const host = getTencentCiHost();
    return host ? `https://${host}` : null;
  }
  const template: string = ch.endpoint;
  if (!template.includes('{workspace}')) return template;
  return /^[a-z0-9-]{3,64}$/i.test(model.workspace_id) ? template.replace('{workspace}',model.workspace_id) : null;
}
/** Why a model can't be used right now, or null if it can. */
export function unusableReason(model: DecisionModel): string|null {
  if (!DECISION_CHANNELS[model.channel]) return '渠道不存在';
  if (!model.enabled) return '未启用';
  if (!keyConfigured(model)) return `缺少 ${channelOf(model).keyEnv}`;
  if (!endpointOf(model)) return '缺少工作空间 ID';
  return null;
}

/**
 * Ordered candidates for a role:
 * - For 'review': follows the user-configured priority chain (`ORDER BY priority ASC`), with optional `preferredId` placed first.
 * - Every enabled & usable model participates in the failover chain in exact priority order.
 */
export function decisionCandidates(role: DecisionRole, preferredId?: string|null): DecisionModel[] {
  decisionDb();
  const allUsable = listDecisionModels().filter(m => !unusableReason(m));
  if (role === 'review') {
    const priorityIds = [preferredId || '', ...allUsable.map(m => m.id)]
      .filter((id, index, all) => id && all.indexOf(id) === index);
    return priorityIds.map(getDecisionModel).filter((m): m is DecisionModel => Boolean(m && !unusableReason(m)));
  }
  const primary = getSetting('decision_intent_model_id');
  const priorityIds = [preferredId || '', primary, ...allUsable.map(m => m.id)]
    .filter((id, index, all) => id && all.indexOf(id) === index);
  return priorityIds.map(getDecisionModel).filter((m): m is DecisionModel => Boolean(m && !unusableReason(m)));
}

export function reviewTotalTimeoutMs(): number {
  decisionDb();
  const raw = Number(getSetting('review_total_timeout_ms'));
  return Number.isFinite(raw) && raw >= 2000 && raw <= 120000 ? Math.round(raw) : 12000;
}

export function decisionRoleStatus(role: DecisionRole) {
  decisionDb();
  const id = getSetting(role==='review'?'decision_review_model_id':'decision_intent_model_id');
  const candidates = decisionCandidates(role);
  const primary = getDecisionModel(id);
  return {id,label:primary?primary.model:id,available:candidates.length>0,
    primary_available:candidates[0]?.id===id,active_id:candidates[0]?.id??null,
    primary_reason:primary?unusableReason(primary):'未设置'};
}
