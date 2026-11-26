import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { DEFAULT_FALLBACK_SCENE, DEFAULT_SYSTEM_PROMPT, ENHANCE_FOCUSED_SYSTEM_PROMPT_V4, SECTIONED_SYSTEM_PROMPT, SECTIONED_SYSTEM_PROMPT_V2, UNIVERSAL_SYSTEM_PROMPT_V5 } from './prompt';
import type { ModelConfig, Provider, RunRecord, SceneConfig } from './types';

let singleton: Database.Database | undefined;

function dataPath() {
  const base = process.env.DATA_DIR || './data';
  const dir = path.resolve(/* turbopackIgnore: true */ base);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return path.join(dir, 'prompt-enhancement.sqlite');
}

export function db(): Database.Database {
  if (singleton) return singleton;
  const conn = new Database(dataPath());
  conn.pragma('journal_mode = WAL');
  conn.pragma('foreign_keys = ON');
  conn.pragma('busy_timeout = 5000');
  conn.exec(`
    CREATE TABLE IF NOT EXISTS prompt_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version INTEGER NOT NULL UNIQUE,
      body TEXT NOT NULL,
      note TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS models (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      timeout_ms INTEGER NOT NULL DEFAULT 12000,
      max_output_tokens INTEGER NOT NULL DEFAULT 900,
      priority INTEGER NOT NULL DEFAULT 100,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      model_id TEXT NOT NULL,
      prompt_version INTEGER NOT NULL,
      status TEXT NOT NULL,
      intent_status TEXT,
      attempts INTEGER NOT NULL DEFAULT 1,
      review_attempts INTEGER NOT NULL DEFAULT 0,
      review_ms INTEGER NOT NULL DEFAULT 0,
      review_model_id TEXT,
      total_ms INTEGER NOT NULL,
      upstream_ms INTEGER NOT NULL,
      input_tokens INTEGER,
      output_tokens INTEGER,
      error_code TEXT,
      input_text TEXT,
      output_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS runs_created_idx ON runs(created_at DESC);
    CREATE INDEX IF NOT EXISTS runs_model_idx ON runs(model_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      subject TEXT NOT NULL,
      detail TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS feedback (
      run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
      action TEXT NOT NULL CHECK(action IN ('accepted','edited','rejected')),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rate_events (
      key_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS rate_event_idx ON rate_events(key_hash, created_at);
    CREATE TABLE IF NOT EXISTS scenes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      rules TEXT NOT NULL DEFAULT '',
      fallback_scene TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );
  `);
  const runColumns = new Set((conn.pragma('table_info(runs)') as Array<{name:string}>).map(column=>column.name));
  if (!runColumns.has('attempts')) {
    conn.exec('ALTER TABLE runs ADD COLUMN attempts INTEGER NOT NULL DEFAULT 1');
    conn.prepare("UPDATE runs SET attempts=0 WHERE status='success' AND upstream_ms=0").run();
  }
  if (!runColumns.has('review_attempts')) conn.exec('ALTER TABLE runs ADD COLUMN review_attempts INTEGER NOT NULL DEFAULT 0');
  if (!runColumns.has('review_ms')) conn.exec('ALTER TABLE runs ADD COLUMN review_ms INTEGER NOT NULL DEFAULT 0');
  if (!runColumns.has('review_model_id')) conn.exec('ALTER TABLE runs ADD COLUMN review_model_id TEXT');
  if (!runColumns.has('entry')) conn.exec('ALTER TABLE runs ADD COLUMN entry TEXT');
  if (!runColumns.has('failover_from')) conn.exec('ALTER TABLE runs ADD COLUMN failover_from TEXT');
  if (!runColumns.has('image_count')) conn.exec('ALTER TABLE runs ADD COLUMN image_count INTEGER NOT NULL DEFAULT 0');
  if (!runColumns.has('vision_ms')) conn.exec('ALTER TABLE runs ADD COLUMN vision_ms INTEGER NOT NULL DEFAULT 0');
  if (!runColumns.has('vision_model_id')) conn.exec('ALTER TABLE runs ADD COLUMN vision_model_id TEXT');
  if (!runColumns.has('intent_ms')) conn.exec('ALTER TABLE runs ADD COLUMN intent_ms INTEGER NOT NULL DEFAULT 0');
  if (!runColumns.has('intent_check')) conn.exec('ALTER TABLE runs ADD COLUMN intent_check TEXT');
  const now = new Date().toISOString();
  conn.prepare('INSERT OR IGNORE INTO prompt_versions(version,body,note,created_by,created_at) VALUES (1,?,?,?,?)')
    .run(DEFAULT_SYSTEM_PROMPT, '出厂版本', 'system', now);
  conn.prepare('INSERT OR IGNORE INTO prompt_versions(version,body,note,created_by,created_at) VALUES (2,?,?,?,?)')
    .run(SECTIONED_SYSTEM_PROMPT_V2, '分段字段语法与画面文字引号规则', 'system', now);
  conn.prepare('INSERT OR IGNORE INTO prompt_versions(version,body,note,created_by,created_at) VALUES (3,?,?,?,?)')
    .run(SECTIONED_SYSTEM_PROMPT, '混合引号与否定文字要求的修正', 'system', now);
  conn.prepare('INSERT OR IGNORE INTO prompt_versions(version,body,note,created_by,created_at) VALUES (4,?,?,?,?)')
    .run(ENHANCE_FOCUSED_SYSTEM_PROMPT_V4, '始终围绕用户原文强化（移除抱枕兜底与拦截）', 'system', now);
  conn.prepare('INSERT OR IGNORE INTO prompt_versions(version,body,note,created_by,created_at) VALUES (5,?,?,?,?)')
    .run(UNIVERSAL_SYSTEM_PROMPT_V5, '全场景通用强化原则（去除写死样例，自适应任意输入）', 'system', now);
  const settings = conn.prepare('INSERT OR IGNORE INTO settings(key,value,updated_at) VALUES (?,?,?)');
  settings.run('active_prompt_version', '5', now);
  settings.run('fallback_scene', DEFAULT_FALLBACK_SCENE, now);
  settings.run('active_model_id', 'runninghub-doubao', now);
  settings.run('backup_model_id', 'qwen-flash', now);
  // Both verified to read images through their channels (base64 and URL).
  settings.run('vision_model_id', 'qwen-flash', now);
  settings.run('vision_backup_model_id', 'runninghub-doubao', now);
  // Intent recognition via Decisions; 'rules' keeps the original heuristic only.
  settings.run('intent_mode', 'decisions', now);
  settings.run('config_revision', '1', now);
  const insertModel = conn.prepare('INSERT OR IGNORE INTO models(id,provider,model,enabled,timeout_ms,max_output_tokens,priority,updated_at) VALUES (?,?,?,?,?,?,?,?)');
  const seeds: Array<[string,Provider,string,number]> = [
    ['runninghub-doubao','runninghub','bytedance/doubao-seed-2.1-lite',0],
    ['qwen-flash','qwen','qwen3.8-flash',1],
    ['gpt-luna','apiyi','gpt-6-luna',2],
    ['gemini-flash-lite','bananarouter','gemini-3.5-flash-lite',3],
    ['runninghub-qwen','runninghub','qwen/qwen3.8-flash-next',4],
    ['runninghub-deepseek','runninghub','deepseek/deepseek-v4.1-flash',5],
    ['deepseek-flash','apiyi','deepseek-flash',6],
  ];
  for (const [id,provider,model,priority] of seeds) insertModel.run(id,provider,model,1,20000,id==='deepseek-flash'?1600:id==='runninghub-doubao'?1400:1200,priority,now);
  // Starter scenes: the homepage and the canvas tools. Rules and fallback start empty (global fallback applies).
  const insertScene = conn.prepare('INSERT OR IGNORE INTO scenes(id,name,rules,fallback_scene,enabled,updated_at) VALUES (?,?,\'\',\'\',1,?)');
  for (const [id,name] of [['home','首页'],['product-reshoot','产品重拍'],['local-edit','局部编辑'],['pattern-layout','花型排版'],['model-gen','真人模特生成']]) insertScene.run(id,name,now);
  // 为空白初始场景自动填充差异化的五大创作动作强化规则与专属兜底示例（仅在空白时写入，不覆盖人工已编辑内容）
  if (!conn.prepare("SELECT 1 FROM settings WHERE key='scenes_seeded_v1'").get()) {
    const defaultScenePresets: Array<[string, string, string]> = [
      [
        'home',
        '面向全新文生图需求：完整保留用户指定的商品品类、颜色、材质、花型图案与数量；合理补齐家居或商业展示环境、织物微距肌理、柔和自然光线与干净构图，避免堆砌空洞形容词。',
        DEFAULT_FALLBACK_SCENE,
      ],
      [
        'product-reshoot',
        '面向产品重拍与换背景需求：必须在 [主体] 段强调严格保持参考图商品主体的款式结构、颜色、材质肌理与花型细节完全不变；重点在 [场景] 与 [光线与构图] 段刻画替换后的新空间环境、地面/台面材质以及与主体自然融合的环境光影与阴影透视。',
        '严格保持参考图中的家纺商品主体款式与花色纹理不变，将其置于采光充足的现代极简原木风卧室场景中，自然柔和窗光投射细腻阴影，画面干净无杂物，无品牌水印。',
      ],
      [
        'local-edit',
        '面向局部修改、去水印、擦除杂物或局部改色改字需求：必须采用简洁精准的编辑指令表达！在 [主体] 段明确指出需要修改、替换或擦除的具体局部位置与目标效果；在 [限制] 段明确声明“原图其余主体、背景构图与光影质感保持原样不变”，严禁无中生有扩写无关家具或重绘整张画面。',
        '保持原图整体商品主体、空间构图与光影完全不变，仅将画面边缘多余杂物与水印文字干净擦除，并自然修补被遮挡处的面料纹理。',
      ],
      [
        'pattern-layout',
        '面向花型纹样无缝平铺（Seamless Pattern）设计需求：必须采用正交垂直俯视平面视角，强调四方连续无缝循环拼接与高清织物/纹样平面细节；在 [限制] 段明确禁止出现床铺沙发等三维透视家具、禁止侧面景深虚化、禁止折痕阴影遮挡与人物出镜。',
        '法式田园清新蓝白小碎花与藤蔓枝叶四方连续无缝平铺图案，米白色纯棉织物底纹清晰，正交俯视平面设计稿，色彩柔和均匀，无透视变形，无阴影遮挡，无文字水印。',
      ],
      [
        'model-gen',
        '面向真人模特穿搭或居家展示需求：刻画自然得体的模特形象、放松生活化的姿态表情，以及模特与所展示家纺/家居服商品的清晰互动关系；确保商品主体完整醒目不被过度遮挡，人物手部与面部比例自然，采用商业人像柔和布光。',
        '一位气质温和的年轻亚洲女模特身穿香槟色真丝长袖睡衣套装，自然放松地坐在明亮现代卧室床边，柔和清晨窗光，面料垂坠光泽清晰，人物着装得体，无文字与品牌标识。',
      ],
    ];
    conn.transaction(() => {
      const updateEmptyScene = conn.prepare("UPDATE scenes SET rules=?, fallback_scene=?, updated_at=? WHERE id=? AND rules='' AND fallback_scene=''");
      for (const [id, rules, fb] of defaultScenePresets) {
        updateEmptyScene.run(rules, fb, now, id);
      }
      // 若尚未配置强化备用模型，自动预置异构备用模型 gemini-flash-lite 提升线上容灾能力
      conn.prepare("UPDATE settings SET value='gemini-flash-lite', updated_at=? WHERE key='backup_model_id' AND value=''").run(now);
      settings.run('scenes_seeded_v1', '1', now);
    })();
  }
  // 清理历史引入的老旧 gpt-4-1-nano 模型，恢复使用新一代主力强化模型（主：qwen-flash / qwen3.8-flash，备：gemini-flash-lite / gemini-3.5-flash-lite）
  if (!conn.prepare("SELECT 1 FROM settings WHERE key='remove_gpt41_nano_v1'").get()) {
    conn.transaction(() => {
      conn.prepare("DELETE FROM models WHERE id='gpt-4-1-nano' OR model LIKE 'gpt-4.1%'").run();
      conn.prepare("UPDATE settings SET value='qwen-flash', updated_at=? WHERE key='active_model_id' AND value='gpt-4-1-nano'").run(now);
      conn.prepare("UPDATE settings SET value='gemini-flash-lite', updated_at=? WHERE key='backup_model_id' AND value IN ('', 'gpt-4-1-nano', 'qwen-flash')").run(now);
      settings.run('remove_gpt41_nano_v1', '1', now);
    })();
  }
  // 升级至 V4：始终围绕用户原文强化，不拦截、不偷换默认抱枕，并同步更新 home 场景通用强化规则
  if (!conn.prepare("SELECT 1 FROM settings WHERE key='enhance_prompt_v4_activated'").get()) {
    conn.transaction(() => {
      conn.prepare("UPDATE settings SET value='4', updated_at=? WHERE key='active_prompt_version' AND value IN ('1','2','3')").run(now);
      conn.prepare("UPDATE scenes SET rules=?, updated_at=? WHERE id='home'").run(
        '面向全新文生图需求：牢牢围绕用户输入原文进行视觉化强化（即使输入仅为数字、字符或简短词语，也将其本身作为核心画面主体或艺术字元素呈现），合理补齐构图、材质质感与自然光影，严禁脱离原文偷换成无关的抱枕或家纺商品。',
        now,
      );
      settings.run('enhance_prompt_v4_activated', '1', now);
    })();
  }
  // 升级至 V5：全场景通用强化原则（去除针对具体测试样例的写死示例，同步精炼 home 场景通用规则）
  if (!conn.prepare("SELECT 1 FROM settings WHERE key='enhance_prompt_v5_activated'").get()) {
    conn.transaction(() => {
      conn.prepare("UPDATE settings SET value='5', updated_at=? WHERE key='active_prompt_version' AND value IN ('1','2','3','4')").run(now);
      conn.prepare("UPDATE scenes SET rules=?, updated_at=? WHERE id='home'").run(
        '面向全新文生图需求：忠实围绕用户输入的核心内容、情绪意象或原始字符展开视觉化强化，完整保留所有显性约束，合理补齐构图、材质肌理、空间氛围与自然光影，避免空洞形容词堆砌。',
        now,
      );
      settings.run('enhance_prompt_v5_activated', '1', now);
    })();
  }
  // 默认提示词强化模型切换为豆包 Seed 2.1 Lite（原生看图），异构备用模型切换为 Qwen 3.8 Flash（百炼直连）
  if (!conn.prepare("SELECT 1 FROM settings WHERE key='default_enhance_doubao_v1'").get()) {
    conn.transaction(() => {
      conn.prepare('INSERT OR IGNORE INTO models(id,provider,model,enabled,timeout_ms,max_output_tokens,priority,updated_at) VALUES (?,?,?,?,?,?,?,?)')
        .run('runninghub-doubao', 'runninghub', 'bytedance/doubao-seed-2.1-lite', 1, 20000, 1400, 0, now);
      conn.prepare("UPDATE models SET enabled=1, priority=0, updated_at=? WHERE id='runninghub-doubao'").run(now);
      conn.prepare("UPDATE settings SET value='runninghub-doubao', updated_at=? WHERE key='active_model_id'").run(now);
      conn.prepare("UPDATE settings SET value='qwen-flash', updated_at=? WHERE key='backup_model_id'").run(now);
      conn.prepare("UPDATE settings SET value='runninghub-doubao', updated_at=? WHERE key='vision_backup_model_id'").run(now);
      settings.run('default_enhance_doubao_v1', '1', now);
    })();
  }
  // A marker prevents later starts from undoing an operator's edits or disabled models.
  if (!conn.prepare("SELECT 1 FROM settings WHERE key='provider_routes_v2'").get()) {
    conn.transaction(() => {
      conn.prepare("UPDATE models SET provider='apiyi',updated_at=? WHERE id='gpt-luna' AND provider='openai' AND model='gpt-6-luna'").run(now);
      conn.prepare("UPDATE models SET provider='bananarouter',updated_at=? WHERE id='gemini-flash-lite' AND provider='gemini' AND model='gemini-3.5-flash-lite'").run(now);
      conn.prepare("UPDATE models SET provider='apiyi',enabled=1,timeout_ms=20000,max_output_tokens=1600,updated_at=? WHERE id='deepseek-flash' AND provider IN ('deepseek','apiyi') AND model='deepseek-flash' AND max_output_tokens=900").run(now);
      settings.run('provider_routes_v2','1',now);
    })();
  }
  singleton = conn;
  return conn;
}

export function getSetting(key: string): string {
  return (db().prepare('SELECT value FROM settings WHERE key=?').get(key) as {value:string}|undefined)?.value || '';
}

export function setSetting(key: string, value: string) {
  db().prepare('INSERT INTO settings(key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at')
    .run(key,value,new Date().toISOString());
}

export function audit(actor: string, action: string, subject: string, detail = '') {
  db().prepare('INSERT INTO audit(actor,action,subject,detail,created_at) VALUES (?,?,?,?,?)')
    .run(actor,action,subject,detail,new Date().toISOString());
}

export function getActivePrompt(): {version:number; body:string} {
  const version = Number(getSetting('active_prompt_version'));
  const row = db().prepare('SELECT version,body FROM prompt_versions WHERE version=?').get(version) as {version:number;body:string}|undefined;
  if (!row) throw new Error('ACTIVE_PROMPT_MISSING');
  return row;
}

export function listModels(): ModelConfig[] {
  return db().prepare('SELECT * FROM models ORDER BY priority,id').all() as ModelConfig[];
}

export function getModel(id: string): ModelConfig | undefined {
  return db().prepare('SELECT * FROM models WHERE id=?').get(id) as ModelConfig | undefined;
}

export function listScenes(): SceneConfig[] {
  return db().prepare('SELECT * FROM scenes ORDER BY rowid').all() as SceneConfig[];
}

export function getScene(id: string): SceneConfig | undefined {
  return db().prepare('SELECT * FROM scenes WHERE id=?').get(id) as SceneConfig | undefined;
}

export function insertRun(run: RunRecord) {
  const database = db();
  const lastCleanup = Number(getSetting('last_run_cleanup')||0);
  if (Date.now()-lastCleanup > 86_400_000) {
    database.prepare("DELETE FROM runs WHERE created_at < ?").run(new Date(Date.now()-90*86_400_000).toISOString());
    setSetting('last_run_cleanup',String(Date.now()));
  }
  database.prepare(`INSERT INTO runs(id,kind,model_id,failover_from,prompt_version,entry,status,intent_status,attempts,review_attempts,review_ms,review_model_id,image_count,vision_ms,vision_model_id,intent_ms,intent_check,total_ms,upstream_ms,input_tokens,output_tokens,error_code,input_text,output_json,created_at)
    VALUES (@id,@kind,@model_id,@failover_from,@prompt_version,@entry,@status,@intent_status,@attempts,@review_attempts,@review_ms,@review_model_id,@image_count,@vision_ms,@vision_model_id,@intent_ms,@intent_check,@total_ms,@upstream_ms,@input_tokens,@output_tokens,@error_code,@input_text,@output_json,@created_at)`)
    .run(run);
}
