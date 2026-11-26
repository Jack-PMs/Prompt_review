import fs from 'node:fs';
import path from 'node:path';

// 加载 .env
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!(k in process.env)) process.env[k] = v;
  }
}

const base = 'http://127.0.0.1:6770';
const liveHeaders = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${process.env.ENHANCE_API_KEY}`,
};
const adminHeaders = {
  'Content-Type': 'application/json',
  Origin: 'http://127.0.0.1:6770',
};

async function main() {
  console.log('1. 预热 PM2 服务上游连接池...');
  await fetch(`${base}/api/v1/enhancements`, {
    method: 'POST',
    headers: liveHeaders,
    body: JSON.stringify({ text: '米色抱枕' }),
  });

  const imgBed = `data:image/jpeg;base64,${fs.readFileSync('data/image_benchmark_120/IMG-107.jpg').toString('base64')}`;
  const imgWatermark = `data:image/jpeg;base64,${fs.readFileSync('data/image_benchmark_120/IMG-112.jpg').toString('base64')}`;

  await fetch(`${base}/api/v1/enhancements`, {
    method: 'POST',
    headers: liveHeaders,
    body: JSON.stringify({ text: '', context: { reference_images: [imgBed] } }),
  });

  console.log('2. 开始执行 11 项全场景端到端实测验收...');
  const cases = [
    { name: '01. 乱码早退(Fallback)', body: { text: '1111111' } },
    { name: '02. 模糊缺主体早退(Clarify)', body: { text: '好看一点，高级感拉满' } },
    { name: '03. 2字极简商品词(抱枕)', body: { text: '抱枕' } },
    { name: '04. 5字极简商品词(小碎花床单)', body: { text: '小碎花床单' } },
    { name: '05. 综合入口->全新文生图', body: { text: '米色粗亚麻方形抱枕放在浅木色客厅沙发上，不要文字' } },
    { name: '06. 综合入口->换背景重拍(带图)', body: { text: '保留这套床品款式花色不变，换成阳光法式奶油风主卧', context: { reference_images: [imgBed] } } },
    { name: '07. 综合入口->局部去水印(带图)', body: { text: '把右下角的小红书水印和英文字母擦除干净，保持被面不变', context: { reference_images: [imgWatermark] } } },
    { name: '08. 综合入口->无缝平铺花型', body: { text: '法式田园蓝白小雏菊无缝循环平铺图案，用于四件套面料印花' } },
    { name: '09. 综合入口->真人模特展示', body: { text: '年轻亚洲女模特身穿香槟色真丝睡衣坐在阳光卧室床边' } },
    { name: '10. 专用模特页->冲突提醒', body: { text: '纯白底亚麻抱枕静物特写，不要任何人物', context: { entry: 'model-gen' } } },
    { name: '11. 传真图空文本->按需看图', body: { text: '', context: { reference_images: [imgBed] } } },
  ];

  const rows: Array<Record<string, unknown>> = [];
  for (const c of cases) {
    const res = await fetch(`${base}/api/v1/enhancements`, {
      method: 'POST',
      headers: liveHeaders,
      body: JSON.stringify(c.body),
    });
    const d = (await res.json()) as Record<string, any>;
    rows.push({
      验收项: c.name,
      HTTP: res.status,
      状态: d.result?.status,
      意图通道: d.result?.intent?.channel,
      实际模型: d.result?.intent?.model_id,
      识别动作: d.result?.intent?.action,
      路由模板: d.routed_scene || '早退',
      识别品类: d.result?.intent?.category?.value || '—',
      冲突: d.result?.conflicts?.length ? '已捕获' : '—',
      意图ms: d.metrics?.intent_ms,
      强化ms: d.metrics?.upstream_ms,
      总耗时ms: d.metrics?.total_ms,
    });
  }
  console.table(rows);

  console.log('\n3. 验证后台配置发布 V2 -> 一键回滚 V1 与默认 800ms 超时...');
  const adminGet = (await fetch(`${base}/api/admin/intent`, { headers: adminHeaders }).then((r) => r.json())) as Record<string, any>;
  console.log('当前意图版本: V' + adminGet.active_version, '| 纯文本默认超时:', adminGet.config.text_channel.timeout_ms + 'ms');

  const cfgDraft = structuredClone(adminGet.config);
  cfgDraft.categories.push({ name: '夏季凉席', description: '含冰丝席、藤席、竹席', enabled: true });
  const pubRes = (await fetch(`${base}/api/admin/intent`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ op: 'publish', config: cfgDraft, note: '验收测试发布新版本' }),
  }).then((r) => r.json())) as Record<string, any>;
  console.log('发布新版本 -> active_version: V' + pubRes.active_version);

  const rbRes = (await fetch(`${base}/api/admin/intent`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ op: 'rollback', target_version: 1 }),
  }).then((r) => r.json())) as Record<string, any>;
  console.log('回滚至初始版 -> active_version: V' + rbRes.active_version);

  console.log('\n4. 抽检提示词审核功能零影响回归...');
  const revHealth = (await fetch(`${base}/api/review/health`, { headers: adminHeaders }).then((r) => r.json())) as Record<string, any>;
  const revTasks = (await fetch(`${base}/api/review/tasks?limit=3`, { headers: adminHeaders }).then((r) => r.json())) as Record<string, any>;
  console.log('审核健康状态: mode=' + revHealth.mode + ', policy=' + revHealth.policy_version + ', 历史记录可查条数=' + (revTasks.tasks?.length ?? 0));

  fs.writeFileSync('data/intent-e2e-acceptance.json', JSON.stringify({ verifiedAt: new Date().toISOString(), rows }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
