/**
 * 生成《提示词强化模型选型实测对比报告（30场景四维正式版）.html》
 * 含「成本 / 效果 / 速度 / 成功率」四维交互式权重切换、主备黄金组合测算与 30 题全量逐字对比。
 */
import fs from 'node:fs';
import path from 'node:path';

const IN_JSON = path.resolve(process.cwd(), 'data/enhance-model-selection-30cases.json');
const OUT_HTML = path.resolve(process.cwd(), '提示词强化模型选型实测对比报告.html');

function esc(str: unknown): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function imgThumbDataUrl(relPath?: string): string {
  if (!relPath) return '';
  const abs = path.resolve(process.cwd(), relPath);
  if (!fs.existsSync(abs)) return '';
  const buf = fs.readFileSync(abs);
  const ext = path.extname(abs).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

interface Summary {
  id: string;
  model: string;
  displayName: string;
  vendor: string;
  channel: string;
  group: 'system_live' | 'survey_candidate';
  nativeVision: boolean;
  priceNote: string;
  roleNote: string;
  totalCases: number;
  successCount: number;
  successRate: number;
  passCount: number;
  passRate: number;
  firstTryPassCount: number;
  firstTryPassRate: number;
  avgNetMs: number;
  p50NetMs: number;
  p95NetMs: number;
  textAvgMs: number;
  imgAvgMs: number;
  avgTotalMs: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  avgChars: number;
  costPer10kCny: number;
  avgBlindScore: number;
  qwenJudgeAvg: number;
  gptJudgeAvg: number;
  textBlindAvg: number;
  imgBlindAvg: number;
  dimensions: {
    qualityScore: number;
    reliabilityScore: number;
    speedScore: number;
    costScore: number;
    compositeScore: number;
  };
}

interface ReportData {
  generatedAt: string;
  promptVersion: number;
  promptNote: string;
  totalCases: number;
  modelsCount: number;
  summaries: Summary[];
  cases: Array<{
    id: string;
    group: string;
    title: string;
    text: string;
    imageFile?: string;
    expectedChecks: string;
    routedSceneId: string | null;
    intentAction: string | null;
    intentMs: number;
  }>;
  resultsByCase: Record<
    string,
    Record<
      string,
      {
        ok: boolean;
        error?: string;
        prompt: string;
        negative_prompt: string;
        attempts: number;
        total_ms: number;
        upstream_ms: number;
        intent_ms: number;
        vision_ms: number;
        enhance_net_ms: number;
        prompt_chars: number;
        checks?: {
          syntaxOk: boolean;
          missing: string[];
          mustIncludeMiss: string[];
          forbiddenHit: string[];
          quoteOk: boolean;
          zeroBlockOk: boolean;
          allChecksPass: boolean;
        };
        judgeScores?: {
          qwenMax?: { total: number; comment: string };
          gpt62?: { total: number; comment: string };
          avgScore: number;
        };
      }
    >
  >;
}

const data = JSON.parse(fs.readFileSync(IN_JSON, 'utf8')) as ReportData;
const ranked = [...data.summaries].sort((a, b) => b.dimensions.compositeScore - a.dimensions.compositeScore);
const genTime = new Date(data.generatedAt).toLocaleString('zh-CN', { hour12: false });

const top1 = ranked[0];
const top2 = ranked[1];
const lowestCost = [...data.summaries].sort((a, b) => a.costPer10kCny - b.costPer10kCny)[0];
const fastestText = [...data.summaries].sort((a, b) => a.textAvgMs - b.textAvgMs)[0];
const bestVision = [...data.summaries].filter((s) => s.nativeVision).sort((a, b) => b.imgBlindAvg - a.imgBlindAvg || a.imgAvgMs - b.imgAvgMs)[0];

const groups = [...new Set(data.cases.map((c) => c.group))];

const summaryClientData = ranked.map((s) => ({
  id: s.id,
  model: s.model,
  displayName: s.displayName,
  vendor: s.vendor,
  channel: s.channel,
  group: s.group,
  nativeVision: s.nativeVision,
  priceNote: s.priceNote,
  totalCases: s.totalCases,
  successCount: s.successCount,
  successRate: s.successRate,
  passCount: s.passCount,
  passRate: s.passRate,
  firstTryPassCount: s.firstTryPassCount,
  avgNetMs: s.avgNetMs,
  p50NetMs: s.p50NetMs,
  p95NetMs: s.p95NetMs,
  textAvgMs: s.textAvgMs,
  imgAvgMs: s.imgAvgMs,
  avgTotalMs: s.avgTotalMs,
  avgInputTokens: s.avgInputTokens,
  avgOutputTokens: s.avgOutputTokens,
  avgChars: s.avgChars,
  costPer10kCny: s.costPer10kCny,
  avgBlindScore: s.avgBlindScore,
  qwenJudgeAvg: s.qwenJudgeAvg,
  gptJudgeAvg: s.gptJudgeAvg,
  textBlindAvg: s.textBlindAvg,
  imgBlindAvg: s.imgBlindAvg,
  dimensions: s.dimensions,
}));

const caseSections = data.cases
  .map((c) => {
    const thumb = imgThumbDataUrl(c.imageFile);
    const cards = ranked
      .map((m) => {
        const r = data.resultsByCase[c.id]?.[m.id];
        if (!r) return '';
        const score = r.judgeScores?.avgScore || 0;
        const scoreBadge = !r.ok
          ? '<span class="badge b-err">调用失败</span>'
          : score >= 88
            ? `<span class="badge b-ok">盲评 ${score} 分</span>`
            : score >= 80
              ? `<span class="badge b-info">盲评 ${score} 分</span>`
              : `<span class="badge b-warn">盲评 ${score} 分</span>`;
        const pills: string[] = [];
        if (r.ok && r.checks) {
          if (r.checks.allChecksPass) pills.push('<span class="pill p-ok">硬指标全过</span>');
          else {
            if (!r.checks.syntaxOk) pills.push('<span class="pill p-err">格式异常</span>');
            if (r.checks.missing.length) pills.push(`<span class="pill p-err">漏约束:${esc(r.checks.missing.join(','))}</span>`);
            if (r.checks.mustIncludeMiss.length) pills.push(`<span class="pill p-warn">缺要点:${esc(r.checks.mustIncludeMiss.join(','))}</span>`);
            if (r.checks.forbiddenHit.length) pills.push(`<span class="pill p-err">误含:${esc(r.checks.forbiddenHit.join(','))}</span>`);
            if (!r.checks.quoteOk) pills.push('<span class="pill p-err">引号规则偏差</span>');
          }
          if (r.attempts > 1) pills.push(`<span class="pill p-warn">重试 ${r.attempts} 次</span>`);
        }
        const notes = [
          r.judgeScores?.qwenMax ? `Qwen-Max(${r.judgeScores.qwenMax.total}): ${r.judgeScores.qwenMax.comment}` : '',
          r.judgeScores?.gpt62 ? `GPT-6.2(${r.judgeScores.gpt62.total}): ${r.judgeScores.gpt62.comment}` : '',
        ]
          .filter(Boolean)
          .map((t) => `<div>${esc(t)}</div>`)
          .join('');

        return `<div class="out-card" data-model="${esc(m.id)}">
          <div class="out-head">
            <div>
              <strong>${esc(m.displayName)}</strong>
              <span class="out-meta"><code>${esc(m.model)}</code> · 净耗 ${r.enhance_net_ms}ms${r.vision_ms ? `（含识图${r.vision_ms}ms）` : ''} · ${r.prompt_chars}字</span>
            </div>
            <div>${scoreBadge}</div>
          </div>
          ${pills.length ? `<div class="pills">${pills.join('')}</div>` : ''}
          ${
            r.ok
              ? `<pre class="prompt-pre">${esc(r.prompt)}</pre>
                 ${r.negative_prompt ? `<div class="neg-line"><strong>negative_prompt：</strong>${esc(r.negative_prompt)}</div>` : ''}
                 ${notes ? `<div class="judge-note">${notes}</div>` : ''}`
              : `<div class="err-box">${esc(r.error || '未知错误')}</div>`
          }
        </div>`;
      })
      .join('\n');

    return `<section class="case-block" data-group="${esc(c.group)}" data-has-img="${c.imageFile ? '1' : '0'}">
      <div class="case-head">
        <div>
          <span class="badge b-info">${esc(c.id)}</span>
          <span class="badge b-purple">${esc(c.group)}</span>
          <strong style="margin-left:6px;font-size:15px">${esc(c.title)}</strong>
          <div class="case-input">原始输入：<code>${esc(c.text)}</code></div>
          <div class="case-meta">豆包意图分流：<strong>${esc(c.intentAction || '—')}</strong> → 模板 <code>${esc(c.routedSceneId || '默认')}</code>（${c.intentMs}ms） · 验收要点：${esc(c.expectedChecks)}</div>
        </div>
        ${thumb ? `<img class="thumb" src="${thumb}" alt="${esc(c.id)}参考图" />` : ''}
      </div>
      <div class="out-grid">${cards}</div>
    </section>`;
  })
  .join('\n');

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>三笙AI · 提示词强化「全原生看图」模型四维正式选型报告（6款主力 × 30全场景）</title>
  <style>
    :root {
      --bg: #0b1020; --panel: #131a2e; --panel-2: #19223c;
      --border: rgba(148, 163, 184, 0.18); --text: #f1f5f9; --muted: #94a3b8;
      --green: #10b981; --sky: #38bdf8; --amber: #f59e0b; --purple: #a855f7; --rose: #f43f5e;
    }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif; background: var(--bg); color: var(--text); line-height: 1.55; padding: 28px 24px 72px; }
    .container { max-width: 1500px; margin: 0 auto; }
    .header { background: linear-gradient(135deg, rgba(56,189,248,0.16), rgba(16,185,129,0.12), rgba(168,85,247,0.10)); border: 1px solid var(--border); border-radius: 16px; padding: 24px 28px; margin-bottom: 22px; }
    .header h1 { margin: 0 0 8px; font-size: 24px; font-weight: 700; }
    .header p { margin: 0; color: var(--muted); font-size: 14px; }
    .meta-chips { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 14px; }
    .chip { background: rgba(15, 23, 42, 0.75); border: 1px solid var(--border); border-radius: 999px; padding: 4px 12px; font-size: 12.5px; color: #cbd5e1; }
    .section-title { font-size: 17px; font-weight: 700; margin: 28px 0 12px; display: flex; align-items: center; gap: 8px; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 14px; }
    .card { background: var(--panel); border: 1px solid var(--border); border-radius: 14px; padding: 18px; }
    .card h3 { margin: 0 0 4px; font-size: 16px; }
    .card .sub { font-size: 12.5px; color: var(--muted); margin-bottom: 10px; }
    .metric-row { display: flex; justify-content: space-between; font-size: 13px; padding: 5px 0; border-bottom: 1px dashed rgba(148,163,184,0.12); }
    .metric-row:last-child { border-bottom: none; }
    .val-good { color: var(--green); font-weight: 700; }
    .val-info { color: var(--sky); font-weight: 700; }
    .val-warn { color: var(--amber); font-weight: 700; }
    .val-bad { color: var(--rose); font-weight: 700; }
    .table-wrap { overflow-x: auto; border-radius: 14px; border: 1px solid var(--border); }
    table { width: 100%; border-collapse: collapse; background: var(--panel); font-size: 13px; }
    th, td { padding: 11px 12px; border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; }
    th { background: var(--panel-2); color: #cbd5e1; font-weight: 600; white-space: nowrap; }
    tr:hover td { background: rgba(255,255,255,0.025); }
    .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .sub-line { color: var(--muted); font-size: 11.5px; margin-top: 2px; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 6px; font-size: 11.5px; font-weight: 600; white-space: nowrap; }
    .b-ok { background: rgba(16,185,129,0.16); color: #34d399; border: 1px solid rgba(16,185,129,0.35); }
    .b-err { background: rgba(244,63,94,0.16); color: #fb7185; border: 1px solid rgba(244,63,94,0.35); }
    .b-info { background: rgba(56,189,248,0.15); color: #7dd3fc; border: 1px solid rgba(56,189,248,0.3); }
    .b-warn { background: rgba(245,158,11,0.16); color: #fcd34d; border: 1px solid rgba(245,158,11,0.35); }
    .b-purple { background: rgba(168,85,247,0.16); color: #d8b4fe; border: 1px solid rgba(168,85,247,0.35); }
    code { background: rgba(148,163,184,0.15); padding: 1px 6px; border-radius: 4px; font-size: 12px; color: #e2e8f0; }
    .weight-bar { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; align-items: center; }
    .filter-btn { background: var(--panel); color: #cbd5e1; border: 1px solid var(--border); border-radius: 8px; padding: 6px 12px; font-size: 12.5px; cursor: pointer; }
    .filter-btn.active { background: var(--sky); color: #0f172a; border-color: var(--sky); font-weight: 700; }
    .bar-mini { display: inline-block; width: 58px; height: 6px; background: rgba(148,163,184,0.18); border-radius: 999px; overflow: hidden; vertical-align: middle; margin-right: 6px; }
    .bar-mini > span { display: block; height: 100%; border-radius: 999px; }
    .filters { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; align-items: center; }
    .filter-label { font-size: 12.5px; color: var(--muted); margin-right: 4px; }
    .case-block { background: var(--panel); border: 1px solid var(--border); border-radius: 14px; padding: 18px; margin-bottom: 18px; }
    .case-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; padding-bottom: 12px; border-bottom: 1px solid var(--border); margin-bottom: 14px; }
    .case-input { margin-top: 8px; font-size: 13.5px; }
    .case-meta { margin-top: 6px; font-size: 12px; color: var(--muted); }
    .thumb { width: 92px; height: 92px; object-fit: cover; border-radius: 10px; border: 1px solid var(--border); flex-shrink: 0; }
    .out-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); gap: 12px; }
    .out-card { background: rgba(15, 23, 42, 0.72); border: 1px solid var(--border); border-radius: 11px; padding: 13px; display: flex; flex-direction: column; gap: 8px; }
    .out-card.hidden { display: none; }
    .out-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
    .out-meta { display: block; font-size: 11.5px; color: var(--muted); margin-top: 2px; }
    .pills { display: flex; flex-wrap: wrap; gap: 5px; }
    .pill { font-size: 11px; padding: 1px 7px; border-radius: 999px; font-weight: 600; }
    .p-ok { background: rgba(16,185,129,0.14); color: #34d399; }
    .p-warn { background: rgba(245,158,11,0.14); color: #fcd34d; }
    .p-err { background: rgba(244,63,94,0.16); color: #fb7185; }
    .prompt-pre { margin: 0; white-space: pre-wrap; word-break: break-word; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif; font-size: 12.5px; line-height: 1.55; background: rgba(11, 16, 32, 0.85); border: 1px solid rgba(148,163,184,0.14); border-radius: 8px; padding: 10px 12px; color: #e2e8f0; }
    .neg-line { font-size: 11.5px; color: #cbd5e1; background: rgba(244,63,94,0.06); border-radius: 6px; padding: 5px 8px; }
    .judge-note { font-size: 11.5px; color: var(--muted); border-top: 1px dashed rgba(148,163,184,0.14); padding-top: 6px; line-height: 1.45; }
    .err-box { background: rgba(244,63,94,0.12); color: #fda4af; border: 1px solid rgba(244,63,94,0.3); border-radius: 8px; padding: 10px; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>三笙AI · 提示词强化「全原生图片理解」模型四维正式选型报告（${data.modelsCount} 款主力 × ${data.totalCases} 全场景）</h1>
      <p>零修改当前线上系统 · 复用生效 V${data.promptVersion} 通用提示词与豆包意图路由 · 全部参评模型 100% 支持原生图片理解 · 严禁任何 OpenAI/Gemini 官方 Key · 综合「效果 + 成功率 + 速度 + 成本」四维决选</p>
      <div class="meta-chips">
        <span class="chip">生成时间：${esc(genTime)}</span>
        <span class="chip">终选模型：${data.modelsCount} 款全原生多模态（5 大厂商）</span>
        <span class="chip">全场景样本：${data.totalCases} 条（24 条纯文本 + 6 张三笙实拍图）</span>
        <span class="chip">盲评裁判：Qwen 3.8 Max + GPT-6.2-Sol 跨厂商交叉盲评</span>
        <span class="chip">总真实调用：${data.modelsCount * data.totalCases} 次</span>
      </div>
    </div>

    <div class="section-title">一、四维综合落地拍板推荐</div>
    <div class="cards">
      <div class="card" style="border-color:rgba(16,185,129,0.48)">
        <h3>🏆 四维综合第一：${esc(top1.displayName)}</h3>
        <div class="sub"><code>${esc(top1.model)}</code> · ${esc(top1.channel)}</div>
        <div class="metric-row"><span>四维均衡综合分</span><span class="val-good" style="font-size:15px">${top1.dimensions.compositeScore} / 100</span></div>
        <div class="metric-row"><span>双裁判盲评效果</span><span>${top1.avgBlindScore} 分（纯文 ${top1.textBlindAvg} / 看图 ${top1.imgBlindAvg}）</span></div>
        <div class="metric-row"><span>成功率 / 硬指标合规</span><span class="val-good">${top1.successCount}/${top1.totalCases}（${top1.successRate}%） / ${top1.passCount}/${top1.totalCases}</span></div>
        <div class="metric-row"><span>纯文均耗 / 带图均耗 / P95</span><span>${top1.textAvgMs}ms / ${top1.imgAvgMs}ms / ${top1.p95NetMs}ms</span></div>
        <div class="metric-row"><span>万次调用估算成本</span><span class="val-good">¥${top1.costPer10kCny}</span></div>
      </div>

      <div class="card" style="border-color:rgba(56,189,248,0.45)">
        <h3>🥈 综合第二 / 最佳异构备选：${esc(top2.displayName)}</h3>
        <div class="sub"><code>${esc(top2.model)}</code> · ${esc(top2.channel)}</div>
        <div class="metric-row"><span>四维均衡综合分</span><span class="val-info" style="font-size:15px">${top2.dimensions.compositeScore} / 100</span></div>
        <div class="metric-row"><span>双裁判盲评效果</span><span>${top2.avgBlindScore} 分（纯文 ${top2.textBlindAvg} / 看图 ${top2.imgBlindAvg}）</span></div>
        <div class="metric-row"><span>成功率 / 硬指标合规</span><span>${top2.successCount}/${top2.totalCases}（${top2.successRate}%） / ${top2.passCount}/${top2.totalCases}</span></div>
        <div class="metric-row"><span>纯文均耗 / 带图均耗 / P95</span><span>${top2.textAvgMs}ms / ${top2.imgAvgMs}ms / ${top2.p95NetMs}ms</span></div>
        <div class="metric-row"><span>万次调用估算成本</span><span>¥${top2.costPer10kCny}</span></div>
      </div>

      <div class="card" style="border-color:rgba(168,85,247,0.45)">
        <h3>📌 单项亮点速查</h3>
        <div class="sub">按业务侧重一键对应最优选择</div>
        <div class="metric-row"><span>💰 最低成本</span><span class="val-good">${esc(lowestCost.displayName)}（¥${lowestCost.costPer10kCny}/万次）</span></div>
        <div class="metric-row"><span>⚡ 纯文本最快</span><span class="val-info">${esc(fastestText.displayName)}（${fastestText.textAvgMs} ms）</span></div>
        <div class="metric-row"><span>🖼️ 原生看图最强</span><span class="val-good">${esc(bestVision.displayName)}（看图 ${bestVision.imgBlindAvg} 分 · ${bestVision.imgAvgMs}ms）</span></div>
        <div class="metric-row"><span>🛡️ 线上主备建议</span><span>主 <strong>${esc(top1.model)}</strong> + 备 <strong>${esc(top2.model)}</strong></span></div>
      </div>
    </div>

    <div class="section-title">二、四维综合评分与实时权重排行榜（点击切换你的业务优先级）</div>
    <div class="weight-bar">
      <span class="filter-label">权重方案：</span>
      <button type="button" class="filter-btn active weight-btn" data-w="35,25,25,15">均衡生产推荐（效35 / 稳25 / 速25 / 价15）</button>
      <button type="button" class="filter-btn weight-btn" data-w="50,25,15,10">效果优先（效50 / 稳25 / 速15 / 价10）</button>
      <button type="button" class="filter-btn weight-btn" data-w="20,25,45,10">极速体验优先（速45 / 稳25 / 效20 / 价10）</button>
      <button type="button" class="filter-btn weight-btn" data-w="20,25,10,45">极致控成本（价45 / 稳25 / 效20 / 速10）</button>
      <button type="button" class="filter-btn weight-btn" data-w="25,45,15,15">稳定性第一（稳45 / 效25 / 速15 / 价15）</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th class="num">排名</th>
            <th>模型 / 渠道</th>
            <th>看图方式</th>
            <th class="num">四维总分</th>
            <th class="num">效果分<br><small>双裁判盲评(Qwen/GPT)</small></th>
            <th class="num">稳定分<br><small>成功 / 硬指标合规</small></th>
            <th class="num">速度分<br><small>纯文 / 带图 / P95</small></th>
            <th class="num">成本分<br><small>万次实测估算(¥)</small></th>
            <th class="num">平均输出</th>
          </tr>
        </thead>
        <tbody id="summary-tbody"></tbody>
      </table>
    </div>
    <div class="sub-line" style="margin-top:8px">
      口径说明：纯文本均耗为模型自身生成时间；带图均耗 = 原生看图生成时间（或非看图模型的「辅助识图 + 文本生成」总净耗）；稳定分 = 50% 接口成功率 + 50% 客观硬指标通过率（格式/显性约束/排除项/引号/零拦截零偷换）；万次成本已含非看图模型按 20% 带图比例分摊的辅助识图费（¥1.2/万次）。
    </div>

    <div class="section-title">三、30 条全场景样本逐条实录对比（支持按场景组与模型自由筛选）</div>
    <div class="filters">
      <span class="filter-label">场景筛选：</span>
      <button type="button" class="filter-btn active grp-btn" data-grp="all">全部 30 条</button>
      ${groups.map((g) => `<button type="button" class="filter-btn grp-btn" data-grp="${esc(g)}">${esc(g)}</button>`).join('\n')}
    </div>
    <div class="filters">
      <span class="filter-label">显示模型：</span>
      <button type="button" class="filter-btn" id="btn-all-models">全选 ${ranked.length} 款</button>
      ${ranked.map((m) => `<button type="button" class="filter-btn active model-toggle" data-mid="${esc(m.id)}">${esc(m.displayName)}</button>`).join('\n')}
    </div>

    <div id="cases-container">${caseSections}</div>
  </div>

  <script>
    const SUMMARY_DATA = ${JSON.stringify(summaryClientData)};
    const tbody = document.getElementById('summary-tbody');

    function miniBar(score, color) {
      return '<span class="bar-mini"><span style="width:' + Math.min(100, Math.max(0, score)) + '%;background:' + color + '"></span></span>';
    }

    function renderSummary(wq, wr, ws, wc) {
      const rows = SUMMARY_DATA.map(s => {
        const comp = Number((s.dimensions.qualityScore * wq + s.dimensions.reliabilityScore * wr + s.dimensions.speedScore * ws + s.dimensions.costScore * wc).toFixed(1));
        return { ...s, comp };
      }).sort((a, b) => b.comp - a.comp);

      tbody.innerHTML = rows.map((s, idx) => {
        const compCls = idx === 0 ? 'val-good' : idx === 1 ? 'val-info' : '';
        const grpBadge = s.group === 'system_live' ? '<span class="badge b-info">系统已启</span>' : '<span class="badge b-purple">新调研</span>';
        const visBadge = s.nativeVision ? '<span class="badge b-ok">原生看图</span>' : '<span class="badge b-warn">辅助识图</span>';
        return '<tr>' +
          '<td class="num"><strong>#' + (idx + 1) + '</strong></td>' +
          '<td><strong>' + s.displayName + '</strong> ' + grpBadge + '<div class="sub-line"><code>' + s.model + '</code> · ' + s.channel + '</div></td>' +
          '<td>' + visBadge + '</td>' +
          '<td class="num"><span class="' + compCls + '" style="font-size:16px">' + s.comp + '</span><div class="sub-line">满分 100</div></td>' +
          '<td class="num">' + miniBar(s.dimensions.qualityScore, '#a855f7') + '<strong>' + s.avgBlindScore + '</strong><div class="sub-line">Qwen ' + s.qwenJudgeAvg + ' / GPT ' + s.gptJudgeAvg + ' · 图 ' + s.imgBlindAvg + '</div></td>' +
          '<td class="num">' + miniBar(s.dimensions.reliabilityScore, '#10b981') + '<strong>' + s.dimensions.reliabilityScore + '</strong><div class="sub-line">成功 ' + s.successCount + '/' + s.totalCases + ' · 合规 ' + s.passCount + '/' + s.totalCases + '</div></td>' +
          '<td class="num">' + miniBar(s.dimensions.speedScore, '#38bdf8') + '<strong>' + s.dimensions.speedScore + '</strong><div class="sub-line">文 ' + s.textAvgMs + 'ms / 图 ' + s.imgAvgMs + 'ms / P95 ' + s.p95NetMs + 'ms</div></td>' +
          '<td class="num">' + miniBar(s.dimensions.costScore, '#f59e0b') + '<strong>¥' + s.costPer10kCny + '</strong><div class="sub-line">成本分 ' + s.dimensions.costScore + ' · 均 ' + s.avgInputTokens + '/' + s.avgOutputTokens + 't</div></td>' +
          '<td class="num">' + s.avgChars + ' 字<div class="sub-line">一次过 ' + s.firstTryPassCount + '/' + s.totalCases + '</div></td>' +
        '</tr>';
      }).join('');
    }

    renderSummary(0.35, 0.25, 0.25, 0.15);

    const wBtns = document.querySelectorAll('.weight-btn');
    wBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        wBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const [q, r, s, c] = btn.dataset.w.split(',').map(n => Number(n) / 100);
        renderSummary(q, r, s, c);
      });
    });

    const grpBtns = document.querySelectorAll('.grp-btn');
    const caseBlocks = document.querySelectorAll('.case-block');
    grpBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        grpBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const g = btn.dataset.grp;
        caseBlocks.forEach(block => {
          block.style.display = (g === 'all' || block.dataset.group === g) ? '' : 'none';
        });
      });
    });

    const modelBtns = document.querySelectorAll('.model-toggle');
    function syncCards() {
      const enabled = new Set([...modelBtns].filter(b => b.classList.contains('active')).map(b => b.dataset.mid));
      document.querySelectorAll('.out-card').forEach(card => {
        card.classList.toggle('hidden', !enabled.has(card.dataset.model));
      });
    }
    modelBtns.forEach(btn => btn.addEventListener('click', () => { btn.classList.toggle('active'); syncCards(); }));
    document.getElementById('btn-all-models').addEventListener('click', () => { modelBtns.forEach(b => b.classList.add('active')); syncCards(); });
  </script>
</body>
</html>`;

fs.writeFileSync(OUT_HTML, html, 'utf8');
console.log(`✅ 30 场景四维正式选型 HTML 报告已生成：${OUT_HTML}`);
