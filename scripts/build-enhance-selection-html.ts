/**
 * 将 data/enhance-model-selection-10cases.json 渲染为高颜值交互式深色 HTML 选型报告
 * 复刻《意图识别模型选型实测对比报告.html》深色数据看板视觉规范
 */
import fs from 'node:fs';
import path from 'node:path';

const IN_JSON = path.resolve(process.cwd(), 'data/enhance-model-selection-10cases.json');
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

interface ReportData {
  generatedAt: string;
  promptVersion: number;
  promptNote: string;
  totalCases: number;
  modelsCount: number;
  summaries: Array<{
    id: string;
    model: string;
    displayName: string;
    vendor: string;
    channel: string;
    group: 'system_live' | 'survey_candidate';
    nativeVision: boolean;
    inputCnyPer1M: number;
    outputCnyPer1M: number;
    priceSource: string;
    note: string;
    totalCases: number;
    successCount: number;
    successRate: number;
    passCount: number;
    passRate: number;
    firstTryPassCount: number;
    firstTryPassRate: number;
    avgUpstreamMs: number;
    p50UpstreamMs: number;
    p95UpstreamMs: number;
    textAvgUpstreamMs: number;
    imgAvgGenMs: number;
    avgTotalMs: number;
    avgInputTokens: number;
    avgOutputTokens: number;
    avgChars: number;
    costPer10kCny: number;
    avgBlindScore: number;
  }>;
  cases: Array<{
    id: string;
    category: string;
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
        input_tokens: number | null;
        output_tokens: number | null;
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
          qwenMax?: { total: number; faithfulness: number; visual: number; format: number; edge: number; comment: string };
          gpt62?: { total: number; faithfulness: number; visual: number; format: number; edge: number; comment: string };
          avgScore: number;
        };
      }
    >
  >;
}

const data = JSON.parse(fs.readFileSync(IN_JSON, 'utf8')) as ReportData;

// 排序：优先看成功率 & 硬指标合规，其次综合双裁判质量、延迟与成本
const ranked = [...data.summaries].sort((a, b) => {
  if (b.successCount !== a.successCount) return b.successCount - a.successCount;
  if (b.passCount !== a.passCount) return b.passCount - a.passCount;
  return b.avgBlindScore - a.avgBlindScore;
});

// 计算推荐梯队
const bestScore = [...data.summaries].filter((s) => s.successCount >= 9).sort((a, b) => b.avgBlindScore - a.avgBlindScore)[0];
const bestSpeed = [...data.summaries].filter((s) => s.successCount >= 9 && s.passCount >= 8).sort((a, b) => a.avgUpstreamMs - b.avgUpstreamMs)[0];
const bestValue = [...data.summaries]
  .filter((s) => s.successCount >= 9 && s.passCount >= 8 && s.nativeVision)
  .sort((a, b) => (b.avgBlindScore / Math.max(b.costPer10kCny, 5) / Math.max(b.avgUpstreamMs / 1000, 1)) - (a.avgBlindScore / Math.max(a.costPer10kCny, 5) / Math.max(a.avgUpstreamMs / 1000, 1)))[0];

const genTime = new Date(data.generatedAt).toLocaleString('zh-CN', { hour12: false });

const summaryRows = ranked
  .map((s, idx) => {
    const scoreCls = s.avgBlindScore >= 90 ? 'val-good' : s.avgBlindScore >= 82 ? 'val-info' : 'val-warn';
    const msCls = s.avgUpstreamMs <= 3000 ? 'val-good' : s.avgUpstreamMs <= 5000 ? 'val-warn' : 'val-bad';
    const passCls = s.passRate >= 90 ? 'val-good' : s.passRate >= 70 ? 'val-warn' : 'val-bad';
    const costCls = s.costPer10kCny <= 20 ? 'val-good' : s.costPer10kCny <= 100 ? 'val-warn' : 'val-bad';
    const groupBadge =
      s.group === 'system_live'
        ? '<span class="badge b-info">系统已启用</span>'
        : '<span class="badge b-purple">本次新调研</span>';
    const visionBadge = s.nativeVision
      ? '<span class="badge b-ok">原生看图</span>'
      : '<span class="badge b-warn">辅助识图</span>';
    return `<tr>
      <td class="num"><strong>#${idx + 1}</strong></td>
      <td>
        <strong>${esc(s.model)}</strong>
        <div class="sub-line">${esc(s.displayName)} · ${esc(s.vendor)}</div>
      </td>
      <td>${groupBadge}<div class="sub-line">${esc(s.channel)}</div></td>
      <td>${visionBadge}</td>
      <td class="num"><span class="${s.successRate === 100 ? 'val-good' : 'val-bad'}">${s.successCount}/${s.totalCases}</span><div class="sub-line">${s.successRate}%</div></td>
      <td class="num"><span class="${passCls}">${s.passCount}/${s.totalCases}</span><div class="sub-line">一次通过 ${s.firstTryPassCount}/${s.totalCases}</div></td>
      <td class="num"><span class="${scoreCls}" style="font-size:15px">${s.avgBlindScore || '—'}</span><div class="sub-line">满分 100</div></td>
      <td class="num"><span class="${msCls}">${s.avgUpstreamMs} ms</span><div class="sub-line">P50 ${s.p50UpstreamMs} / P95 ${s.p95UpstreamMs}</div></td>
      <td class="num">${s.imgAvgGenMs} ms<div class="sub-line">端到端 ${s.avgTotalMs} ms</div></td>
      <td class="num"><span class="${costCls}">¥${s.costPer10kCny}</span><div class="sub-line">均 ${s.avgInputTokens}/${s.avgOutputTokens} tok</div></td>
      <td class="num">${s.avgChars} 字</td>
    </tr>`;
  })
  .join('\n');

// 渠道生态调研总览表（含本次探活但未入选/未开通的说明，防止 PM 疑惑“为什么没测 XX”）
const surveyNotes = `
<div class="card" style="margin-top:14px">
  <h3 style="margin-bottom:8px">附：本次 5 大已接入渠道最新模型全景调研结论（2026-11 实时探活）</h3>
  <div class="survey-grid">
    <div class="survey-item">
      <strong>阿里云百炼（DASHSCOPE）</strong>
      <p>可用最新：<code>qwen3.8-flash</code>（主选）、<code>qwen3.8-max</code>（旗舰，已入测）、<code>deepseek-v4.1-flash</code>。注：百炼上的 <code>ZHIPU/GLM-5.3-Flash</code>、<code>MiniMax-M3.1-Flash</code> 实测返回 400 未开通商品，本次未纳入。</p>
    </div>
    <div class="survey-item">
      <strong>API易（APIYI）</strong>
      <p>可用最新：<code>gpt-6-luna</code>、<code>gpt-6.2-sol</code>（已入测）、<code>gemini-3.8-flash</code>（已入测）、<code>claude-haiku-4-5-20251001</code>（已入测）。支持全系原生看图与 OpenAI 兼容协议。</p>
    </div>
    <div class="survey-item">
      <strong>BananaRouter</strong>
      <p>可用最新：<code>gemini-3.5-flash-lite</code>（系统备选）、<code>gemini-3.6-flash</code>（探活 4.4s 偏慢，已被更新更快的 API易 <code>gemini-3.8-flash</code> 覆盖）。</p>
    </div>
    <div class="survey-item">
      <strong>RunningHub & LoopRouter</strong>
      <p>RunningHub 可用：<code>deepseek/deepseek-v4.1-flash</code>（系统已启）、<code>bytedance/doubao-seed-2.1-lite</code>（已入测，纯文本极速，但该渠道暂不支持原生传图）、<code>glm/glm-5.3-flash</code>（默认深度思考占输出）。LoopRouter 仅开放 <code>doubao-seed-2-1-lite-260915</code> 与 <code>gpt-6-luna</code>（专用于意图识别与审核）。</p>
    </div>
  </div>
</div>`;

const caseSections = data.cases
  .map((c) => {
    const thumb = imgThumbDataUrl(c.imageFile);
    const modelCards = ranked
      .map((m) => {
        const r = data.resultsByCase[c.id]?.[m.id];
        if (!r) return '';
        const score = r.judgeScores?.avgScore || 0;
        const scoreBadge = !r.ok
          ? `<span class="badge b-err">调用失败</span>`
          : score >= 90
            ? `<span class="badge b-ok">盲评 ${score} 分</span>`
            : score >= 82
              ? `<span class="badge b-info">盲评 ${score} 分</span>`
              : `<span class="badge b-warn">盲评 ${score} 分</span>`;
        const checkPills: string[] = [];
        if (r.ok && r.checks) {
          if (r.checks.allChecksPass) checkPills.push('<span class="pill p-ok">硬指标全过</span>');
          else {
            if (!r.checks.syntaxOk) checkPills.push('<span class="pill p-err">格式异常</span>');
            if (r.checks.missing.length) checkPills.push(`<span class="pill p-err">漏约束:${esc(r.checks.missing.join(','))}</span>`);
            if (r.checks.mustIncludeMiss.length) checkPills.push(`<span class="pill p-warn">缺要点:${esc(r.checks.mustIncludeMiss.join(','))}</span>`);
            if (r.checks.forbiddenHit.length) checkPills.push(`<span class="pill p-err">误含:${esc(r.checks.forbiddenHit.join(','))}</span>`);
            if (!r.checks.quoteOk) checkPills.push('<span class="pill p-err">引号规则偏差</span>');
          }
          if (r.attempts > 1) checkPills.push(`<span class="pill p-warn">重试 ${r.attempts} 次</span>`);
        }
        const qComment = r.judgeScores?.qwenMax ? `Qwen-Max(${r.judgeScores.qwenMax.total}): ${r.judgeScores.qwenMax.comment}` : '';
        const gComment = r.judgeScores?.gpt62 ? `GPT-6.2(${r.judgeScores.gpt62.total}): ${r.judgeScores.gpt62.comment}` : '';
        const commentsHtml = [qComment, gComment].filter(Boolean).map((t) => `<div>${esc(t)}</div>`).join('');

        return `<div class="out-card" data-model="${esc(m.id)}" data-group="${esc(m.group)}">
          <div class="out-head">
            <div>
              <strong>${esc(m.model)}</strong>
              <span class="out-meta">${m.group === 'system_live' ? '系统已启' : '新调研'} · 生成 ${r.upstream_ms}ms${r.vision_ms ? ` + 识图 ${r.vision_ms}ms` : ''} · ${r.prompt_chars}字</span>
            </div>
            <div>${scoreBadge}</div>
          </div>
          ${checkPills.length ? `<div class="pills">${checkPills.join('')}</div>` : ''}
          ${
            r.ok
              ? `<pre class="prompt-pre">${esc(r.prompt)}</pre>
                 ${r.negative_prompt ? `<div class="neg-line"><strong>negative_prompt：</strong>${esc(r.negative_prompt)}</div>` : ''}
                 ${commentsHtml ? `<div class="judge-note">${commentsHtml}</div>` : ''}`
              : `<div class="err-box">${esc(r.error || '未知错误')}</div>`
          }
        </div>`;
      })
      .join('\n');

    return `<section class="case-block" data-cat="${esc(c.category)}" data-has-img="${c.imageFile ? '1' : '0'}">
      <div class="case-head">
        <div>
          <span class="badge b-info">${esc(c.id)}</span>
          <span class="badge b-purple">${esc(c.category)}</span>
          <strong style="margin-left:6px;font-size:15px">${esc(c.title)}</strong>
          <div class="case-input">原始输入：<code>${esc(c.text)}</code></div>
          <div class="case-meta">豆包意图分流：<strong>${esc(c.intentAction || '—')}</strong> → 模板 <code>${esc(c.routedSceneId || '默认')}</code>（${c.intentMs}ms） · 验收焦点：${esc(c.expectedChecks)}</div>
        </div>
        ${thumb ? `<img class="thumb" src="${thumb}" alt="${esc(c.id)}参考图" />` : ''}
      </div>
      <div class="out-grid">
        ${modelCards}
      </div>
    </section>`;
  })
  .join('\n');

const modelToggleButtons = ranked
  .map((m) => `<button type="button" class="filter-btn active model-toggle" data-mid="${esc(m.id)}">${esc(m.model)}</button>`)
  .join('\n');

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>三笙AI · 提示词强化模型选型实测对比报告（9款模型 × 10全场景）</title>
  <style>
    :root {
      --bg: #0b1020;
      --panel: #131a2e;
      --panel-2: #19223c;
      --border: rgba(148, 163, 184, 0.18);
      --text: #f1f5f9;
      --muted: #94a3b8;
      --green: #10b981;
      --sky: #38bdf8;
      --amber: #f59e0b;
      --purple: #a855f7;
      --rose: #f43f5e;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.55;
      padding: 28px 24px 72px;
    }
    .container { max-width: 1480px; margin: 0 auto; }
    .header {
      background: linear-gradient(135deg, rgba(56,189,248,0.16), rgba(168,85,247,0.12), rgba(16,185,129,0.10));
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 24px 28px;
      margin-bottom: 22px;
    }
    .header h1 { margin: 0 0 8px; font-size: 24px; font-weight: 700; }
    .header p { margin: 0; color: var(--muted); font-size: 14px; }
    .meta-chips { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 14px; }
    .chip {
      background: rgba(15, 23, 42, 0.75);
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 4px 12px;
      font-size: 12.5px;
      color: #cbd5e1;
    }
    .section-title {
      font-size: 17px;
      font-weight: 700;
      margin: 28px 0 12px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(290px, 1fr));
      gap: 14px;
    }
    .card {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 18px;
    }
    .card h3 { margin: 0 0 4px; font-size: 16px; }
    .card .sub { font-size: 12.5px; color: var(--muted); margin-bottom: 10px; }
    .metric-row { display: flex; justify-content: space-between; font-size: 13px; padding: 5px 0; border-bottom: 1px dashed rgba(148,163,184,0.12); }
    .metric-row:last-child { border-bottom: none; }
    .val-good { color: var(--green); font-weight: 700; }
    .val-info { color: var(--sky); font-weight: 700; }
    .val-warn { color: var(--amber); font-weight: 700; }
    .val-bad { color: var(--rose); font-weight: 700; }
    .table-wrap { overflow-x: auto; border-radius: 14px; border: 1px solid var(--border); }
    table {
      width: 100%;
      border-collapse: collapse;
      background: var(--panel);
      font-size: 13px;
    }
    th, td {
      padding: 11px 12px;
      border-bottom: 1px solid var(--border);
      text-align: left;
      vertical-align: top;
    }
    th {
      background: var(--panel-2);
      color: #cbd5e1;
      font-weight: 600;
      white-space: nowrap;
    }
    tr:hover td { background: rgba(255,255,255,0.025); }
    .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .sub-line { color: var(--muted); font-size: 11.5px; margin-top: 2px; }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 6px;
      font-size: 11.5px;
      font-weight: 600;
      white-space: nowrap;
    }
    .b-ok { background: rgba(16,185,129,0.16); color: #34d399; border: 1px solid rgba(16,185,129,0.35); }
    .b-err { background: rgba(244,63,94,0.16); color: #fb7185; border: 1px solid rgba(244,63,94,0.35); }
    .b-info { background: rgba(56,189,248,0.15); color: #7dd3fc; border: 1px solid rgba(56,189,248,0.3); }
    .b-warn { background: rgba(245,158,11,0.16); color: #fcd34d; border: 1px solid rgba(245,158,11,0.35); }
    .b-purple { background: rgba(168,85,247,0.16); color: #d8b4fe; border: 1px solid rgba(168,85,247,0.35); }
    .survey-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; margin-top: 8px; }
    .survey-item { background: rgba(15,23,42,0.55); border: 1px solid var(--border); border-radius: 10px; padding: 12px; font-size: 12.5px; }
    .survey-item p { margin: 6px 0 0; color: #cbd5e1; }
    code { background: rgba(148,163,184,0.15); padding: 1px 6px; border-radius: 4px; font-size: 12px; color: #e2e8f0; }
    .filters { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; align-items: center; }
    .filter-label { font-size: 12.5px; color: var(--muted); margin-right: 4px; }
    .filter-btn {
      background: var(--panel);
      color: #cbd5e1;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 5px 11px;
      font-size: 12px;
      cursor: pointer;
    }
    .filter-btn.active {
      background: var(--sky);
      color: #0f172a;
      border-color: var(--sky);
      font-weight: 700;
    }
    .case-block {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 18px;
      margin-bottom: 18px;
    }
    .case-head {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 14px;
    }
    .case-input { margin-top: 8px; font-size: 13.5px; }
    .case-meta { margin-top: 6px; font-size: 12px; color: var(--muted); }
    .thumb {
      width: 92px;
      height: 92px;
      object-fit: cover;
      border-radius: 10px;
      border: 1px solid var(--border);
      flex-shrink: 0;
    }
    .out-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(410px, 1fr));
      gap: 12px;
    }
    .out-card {
      background: rgba(15, 23, 42, 0.72);
      border: 1px solid var(--border);
      border-radius: 11px;
      padding: 13px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .out-card.hidden { display: none; }
    .out-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
    .out-meta { display: block; font-size: 11.5px; color: var(--muted); margin-top: 2px; }
    .pills { display: flex; flex-wrap: wrap; gap: 5px; }
    .pill { font-size: 11px; padding: 1px 7px; border-radius: 999px; font-weight: 600; }
    .p-ok { background: rgba(16,185,129,0.14); color: #34d399; }
    .p-warn { background: rgba(245,158,11,0.14); color: #fcd34d; }
    .p-err { background: rgba(244,63,94,0.16); color: #fb7185; }
    .prompt-pre {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
      font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
      font-size: 12.5px;
      line-height: 1.55;
      background: rgba(11, 16, 32, 0.85);
      border: 1px solid rgba(148,163,184,0.14);
      border-radius: 8px;
      padding: 10px 12px;
      color: #e2e8f0;
    }
    .neg-line { font-size: 11.5px; color: #cbd5e1; background: rgba(244,63,94,0.06); border-radius: 6px; padding: 5px 8px; }
    .judge-note { font-size: 11.5px; color: var(--muted); border-top: 1px dashed rgba(148,163,184,0.14); padding-top: 6px; line-height: 1.45; }
    .err-box { background: rgba(244,63,94,0.12); color: #fda4af; border: 1px solid rgba(244,63,94,0.3); border-radius: 8px; padding: 10px; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>三笙AI · 提示词强化模型选型实测对比报告（首轮 10 场景全维度）</h1>
      <p>零修改当前线上系统 · 复用当前生效通用提示词 V${data.promptVersion} + 豆包意图路由 + 五大场景规则 · 4 款系统已启模型 + 5 款本次调研新模型同口径横评</p>
      <div class="meta-chips">
        <span class="chip">生成时间：${esc(genTime)}</span>
        <span class="chip">参评模型：${data.modelsCount} 款（5 大厂商）</span>
        <span class="chip">评测样本：${data.totalCases} 条（8 条纯文本 + 2 条三笙实拍图）</span>
        <span class="chip">盲评裁判：Qwen 3.8 Max + GPT-6.2-Sol 跨厂商交叉盲评</span>
        <span class="chip">系统零改动：已验证</span>
      </div>
    </div>

    <div class="section-title">一、三档选型决策建议（一页看懂怎么选）</div>
    <div class="cards">
      ${
        bestValue
          ? `<div class="card" style="border-color:rgba(16,185,129,0.45)">
        <h3>🏆 综合性价比首选：${esc(bestValue.model)}</h3>
        <div class="sub">${esc(bestValue.channel)} · ${bestValue.nativeVision ? '支持原生看图' : '辅助识图'}</div>
        <div class="metric-row"><span>双裁判盲评均分</span><span class="val-good">${bestValue.avgBlindScore} / 100</span></div>
        <div class="metric-row"><span>客观硬指标通过</span><span class="val-good">${bestValue.passCount} / ${bestValue.totalCases}（${bestValue.passRate}%）</span></div>
        <div class="metric-row"><span>纯生成均耗 / P95</span><span>${bestValue.avgUpstreamMs} ms / ${bestValue.p95UpstreamMs} ms</span></div>
        <div class="metric-row"><span>万次调用估算成本</span><span class="val-good">¥${bestValue.costPer10kCny}</span></div>
      </div>`
          : ''
      }
      ${
        bestScore
          ? `<div class="card" style="border-color:rgba(168,85,247,0.45)">
        <h3>👑 视觉文笔质量冠军：${esc(bestScore.model)}</h3>
        <div class="sub">${esc(bestScore.channel)} · ${bestScore.nativeVision ? '支持原生看图' : '辅助识图'}</div>
        <div class="metric-row"><span>双裁判盲评均分</span><span class="val-good">${bestScore.avgBlindScore} / 100</span></div>
        <div class="metric-row"><span>客观硬指标通过</span><span>${bestScore.passCount} / ${bestScore.totalCases}（${bestScore.passRate}%）</span></div>
        <div class="metric-row"><span>纯生成均耗 / P95</span><span>${bestScore.avgUpstreamMs} ms / ${bestScore.p95UpstreamMs} ms</span></div>
        <div class="metric-row"><span>万次调用估算成本</span><span class="val-warn">¥${bestScore.costPer10kCny}</span></div>
      </div>`
          : ''
      }
      ${
        bestSpeed
          ? `<div class="card" style="border-color:rgba(56,189,248,0.45)">
        <h3>⚡ 极速响应冠军：${esc(bestSpeed.model)}</h3>
        <div class="sub">${esc(bestSpeed.channel)} · ${bestSpeed.nativeVision ? '支持原生看图' : '辅助识图'}</div>
        <div class="metric-row"><span>纯生成均耗 / P50</span><span class="val-good">${bestSpeed.avgUpstreamMs} ms / ${bestSpeed.p50UpstreamMs} ms</span></div>
        <div class="metric-row"><span>双裁判盲评均分</span><span>${bestSpeed.avgBlindScore} / 100</span></div>
        <div class="metric-row"><span>客观硬指标通过</span><span>${bestSpeed.passCount} / ${bestSpeed.totalCases}</span></div>
        <div class="metric-row"><span>万次调用估算成本</span><span>¥${bestSpeed.costPer10kCny}</span></div>
      </div>`
          : ''
      }
    </div>

    <div class="section-title">二、9 款候选模型核心决策总表（按硬指标通过数 + 盲评均分排序）</div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th class="num">排名</th>
            <th>模型 ID / 厂商</th>
            <th>来源 / 调用渠道</th>
            <th>多模态看图</th>
            <th class="num">接口成功</th>
            <th class="num">硬指标合规<br><small>(格式+约束+引号+零偷换)</small></th>
            <th class="num">双裁判盲评<br><small>(交叉匿名均分)</small></th>
            <th class="num">纯生成均耗<br><small>(P50 / P95)</small></th>
            <th class="num">带图生成均耗<br><small>(含辅助识图)</small></th>
            <th class="num">万次估算成本<br><small>(按实测Token)</small></th>
            <th class="num">平均输出字数</th>
          </tr>
        </thead>
        <tbody>
          ${summaryRows}
        </tbody>
      </table>
    </div>

    ${surveyNotes}

    <div class="section-title">三、10 条全场景样本逐条输出实录对比（支持按场景与模型自由筛选）</div>
    <div class="filters">
      <span class="filter-label">样本筛选：</span>
      <button type="button" class="filter-btn active cat-btn" data-filter="all">全部 10 条</button>
      <button type="button" class="filter-btn cat-btn" data-filter="text">纯文本 (8)</button>
      <button type="button" class="filter-btn cat-btn" data-filter="img">三笙真图 (2)</button>
      <button type="button" class="filter-btn cat-btn" data-filter="edge">边界词/IP (3)</button>
    </div>
    <div class="filters">
      <span class="filter-label">显示模型（点击开关）：</span>
      <button type="button" class="filter-btn" id="btn-all-models">全选</button>
      <button type="button" class="filter-btn" id="btn-sys-models">仅系统已启 4 款</button>
      <button type="button" class="filter-btn" id="btn-new-models">仅新调研 5 款</button>
      ${modelToggleButtons}
    </div>

    <div id="cases-container">
      ${caseSections}
    </div>
  </div>

  <script>
    const catBtns = document.querySelectorAll('.cat-btn');
    const caseBlocks = document.querySelectorAll('.case-block');
    catBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        catBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const f = btn.dataset.filter;
        caseBlocks.forEach(block => {
          const hasImg = block.dataset.hasImg === '1';
          const cat = block.dataset.cat || '';
          const show = f === 'all' || (f === 'img' && hasImg) || (f === 'text' && !hasImg) || (f === 'edge' && cat.includes('边界'));
          block.style.display = show ? '' : 'none';
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
    modelBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        btn.classList.toggle('active');
        syncCards();
      });
    });
    document.getElementById('btn-all-models').addEventListener('click', () => {
      modelBtns.forEach(b => b.classList.add('active'));
      syncCards();
    });
    document.getElementById('btn-sys-models').addEventListener('click', () => {
      modelBtns.forEach(b => {
        const isSys = b.dataset.mid.startsWith('sys-');
        b.classList.toggle('active', isSys);
      });
      syncCards();
    });
    document.getElementById('btn-new-models').addEventListener('click', () => {
      modelBtns.forEach(b => {
        const isNew = b.dataset.mid.startsWith('new-');
        b.classList.toggle('active', isNew);
      });
      syncCards();
    });
  </script>
</body>
</html>`;

fs.writeFileSync(OUT_HTML, html, 'utf8');
console.log(`✅ 可视化 HTML 选型报告已生成：${OUT_HTML}`);
