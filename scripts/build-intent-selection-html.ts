/**
 * 将 data/intent-model-selection-report.json 渲染为面向产品经理决策的可视化选型报告 HTML
 */
import fs from 'node:fs';
import path from 'node:path';

const reportPath = path.resolve(process.cwd(), 'data/intent-model-selection-report.json');
const outHtmlPath = path.resolve(process.cwd(), '意图识别模型选型实测对比报告.html');

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const stateLabel: Record<string, string> = {
  clear: '明确可强化',
  clarify: '模糊需追问',
  fallback: '乱码/无关兜底',
};

const actionLabel: Record<string, string> = {
  text_to_image: '全新文生图',
  product_reshoot: '换背景重拍',
  local_edit: '局部修改改图',
  pattern_design: '花型纹样平铺',
  model_showcase: '真人模特展示',
  none: '早退无动作',
};

const summaries = report.modelSummaries as Array<Record<string, any>>;
const cases = report.caseResults as Array<Record<string, any>>;

// 为按需看图样本内嵌缩略图（压缩读取原图转 base64 或相对路径引用，这里用相对路径 data/... 在本地双击 HTML 直接可看！）
const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>三笙AI · 提示词强化「用户意图识别」模型选型实测对比报告</title>
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
      padding: 28px 24px 64px;
    }
    .container { max-width: 1420px; margin: 0 auto; }
    .header {
      background: linear-gradient(135deg, rgba(56,189,248,0.14), rgba(16,185,129,0.10));
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 24px 28px;
      margin-bottom: 22px;
    }
    .header h1 { margin: 0 0 8px; font-size: 24px; font-weight: 700; }
    .header p { margin: 0; color: var(--muted); font-size: 14px; }
    .meta-chips { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 14px; }
    .chip {
      background: rgba(15, 23, 42, 0.7);
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 4px 12px;
      font-size: 12.5px;
      color: #cbd5e1;
    }
    .section-title {
      font-size: 17px;
      font-weight: 700;
      margin: 26px 0 12px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 14px;
    }
    .card {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 18px;
    }
    .card h3 { margin: 0 0 4px; font-size: 16px; }
    .card .sub { font-size: 12px; color: var(--muted); margin-bottom: 12px; }
    .metric-row { display: flex; justify-content: space-between; font-size: 13px; padding: 5px 0; border-bottom: 1px dashed rgba(148,163,184,0.1); }
    .metric-row:last-child { border-bottom: none; }
    .val-good { color: var(--green); font-weight: 700; }
    .val-warn { color: var(--amber); font-weight: 700; }
    .val-bad { color: var(--rose); font-weight: 700; }
    table {
      width: 100%;
      border-collapse: collapse;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 14px;
      overflow: hidden;
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
    tr:hover td { background: rgba(255,255,255,0.02); }
    .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
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
    .filters {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 14px;
    }
    .filter-btn {
      background: var(--panel);
      color: #cbd5e1;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 6px 12px;
      font-size: 12.5px;
      cursor: pointer;
    }
    .filter-btn.active {
      background: var(--sky);
      color: #0f172a;
      border-color: var(--sky);
      font-weight: 700;
    }
    .thumb {
      width: 68px;
      height: 68px;
      object-fit: cover;
      border-radius: 8px;
      border: 1px solid var(--border);
      display: block;
      margin-top: 6px;
    }
    .cell-pred { font-size: 12px; line-height: 1.45; }
    .cell-pred .ms { color: var(--muted); font-size: 11px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>三笙AI · 提示词强化「用户意图识别」模型选型实测对比报告</h1>
      <p>独立离线选型压测（零修改线上提示词审核功能） · 模拟 PM2 常驻热连接稳态延迟 · 三层意图体系（输入状态 + 创作动作 + 品类与文字/排除特征）</p>
      <div class="meta-chips">
        <span class="chip">生成时间：${esc(report.generatedAtLocal)}</span>
        <span class="chip">总评测样本：${report.totalCases} 条</span>
        <span class="chip">常态纯文本极速通道：${report.textCasesCount} 条（目标 ≤400ms）</span>
        <span class="chip">按需看图多模态通道：${report.visionCasesCount} 条（三笙真实上传图）</span>
        <span class="chip">参评模型：${summaries.length} 款</span>
      </div>
    </div>

    <div class="section-title">一、5 款候选模型核心决策总表</div>
    <table>
      <thead>
        <tr>
          <th>候选模型</th>
          <th>技术路线 / 渠道</th>
          <th>看图能力</th>
          <th class="num">纯文本路由准确率<br><small>(状态+动作)</small></th>
          <th class="num">纯文本品类准确率</th>
          <th class="num">纯文本全维命中率<br><small>(5项全对)</small></th>
          <th class="num">纯文本平均延迟</th>
          <th class="num">纯文本 P95 延迟</th>
          <th class="num">≤400ms 达标率</th>
          <th class="num">按需看图准确率<br><small>(10张真图)</small></th>
          <th class="num">按需看图均耗</th>
          <th class="num">每万次纯文本成本</th>
        </tr>
      </thead>
      <tbody>
        ${summaries
          .map((s) => {
            const avgCls = s.textAvgMs <= 400 ? 'val-good' : s.textAvgMs <= 800 ? 'val-warn' : 'val-bad';
            const accCls = s.textCoreRoutingAcc >= 90 ? 'val-good' : s.textCoreRoutingAcc >= 80 ? 'val-warn' : 'val-bad';
            return `<tr>
              <td><strong>${esc(s.name)}</strong></td>
              <td><span class="badge b-info">${esc(s.routeType)}</span><div style="color:var(--muted);font-size:11.5px;margin-top:3px">${esc(s.vendor)}</div></td>
              <td>${s.supportsVision ? '<span class="badge b-ok">支持多模态</span>' : '<span class="badge b-warn">仅纯文本</span>'}</td>
              <td class="num ${accCls}">${s.textCoreRoutingAcc}%</td>
              <td class="num">${s.textCategoryAcc}%</td>
              <td class="num">${s.textFullMatchAcc}%</td>
              <td class="num ${avgCls}">${s.textAvgMs} ms</td>
              <td class="num">${s.textP95Ms} ms</td>
              <td class="num ${s.textUnder400msRate >= 80 ? 'val-good' : ''}">${s.textUnder400msRate}%</td>
              <td class="num">${s.visionCoreRoutingAcc !== null ? `${s.visionCoreRoutingAcc}%（品类 ${s.visionCategoryAcc}%）` : '—'}</td>
              <td class="num">${s.visionAvgMs !== null ? `${s.visionAvgMs} ms` : '—'}</td>
              <td class="num"><strong>¥${s.costPer10kTextRmb}</strong></td>
            </tr>`;
          })
          .join('')}
      </tbody>
    </table>

    <div class="section-title">二、模型能力卡片对比</div>
    <div class="cards">
      ${summaries
        .map(
          (s) => `<div class="card">
        <h3>${esc(s.name)}</h3>
        <div class="sub">${esc(s.vendor)}</div>
        <div class="metric-row"><span>纯文本核心路由准确率</span><span class="${s.textCoreRoutingAcc >= 90 ? 'val-good' : 'val-warn'}">${s.textCoreRoutingAcc}%</span></div>
        <div class="metric-row"><span>纯文本平均 / P50 / P95</span><span><strong>${s.textAvgMs}ms</strong> / ${s.textP50Ms}ms / ${s.textP95Ms}ms</span></div>
        <div class="metric-row"><span>≤400ms 极速达标率</span><span>${s.textUnder400msRate}%</span></div>
        <div class="metric-row"><span>文字引号与排除标记准确率</span><span>${s.textFlagsAcc}%</span></div>
        <div class="metric-row"><span>按需看图路由准确率 / 均耗</span><span>${s.visionCoreRoutingAcc !== null ? `${s.visionCoreRoutingAcc}% / ${s.visionAvgMs}ms` : '不支持看图'}</span></div>
        <div class="metric-row"><span>每 10,000 次调用预估成本</span><span>¥${s.costPer10kTextRmb}</span></div>
      </div>`,
        )
        .join('')}
    </div>

    <div class="section-title">三、70 条黄金样本逐条实测明细</div>
    <div class="filters" id="filters">
      <button class="filter-btn active" data-group="ALL">全部 (${cases.length})</button>
      <button class="filter-btn" data-group="DIFF">存在模型分歧的样本</button>
      ${[...new Set(cases.map((c) => c.group))]
        .map((g) => `<button class="filter-btn" data-group="${esc(g)}">${esc(g)} (${cases.filter((c) => c.group === g).length})</button>`)
        .join('')}
    </div>

    <table id="detail-table">
      <thead>
        <tr>
          <th>编号 / 场景组</th>
          <th style="min-width:240px">用户输入 & 上下文</th>
          <th>预期标准答案</th>
          ${summaries.map((s) => `<th>${esc(s.name)}</th>`).join('')}
        </tr>
      </thead>
      <tbody>
        ${cases
          .map((c) => {
            const applicableRuns = Object.values(c.runs) as Array<Record<string, any>>;
            const hasDiff = applicableRuns.some((r) => !r.coreRoutingMatch);
            return `<tr data-group="${esc(c.group)}" data-diff="${hasDiff ? '1' : '0'}">
              <td>
                <strong>${esc(c.id)}</strong>
                <div style="margin-top:4px"><span class="badge ${c.channelType === 'vision_ondemand' ? 'b-warn' : 'b-info'}">${esc(c.group)}</span></div>
              </td>
              <td>
                <div style="font-weight:600;margin-bottom:4px">${esc(c.title)}</div>
                <div style="color:#e2e8f0">${c.text ? esc(c.text) : '<em style="color:var(--muted)">（空文本，仅上传参考图）</em>'}</div>
                <div style="font-size:11.5px;color:var(--muted);margin-top:4px">传图数: ${c.imageCount}${c.entry ? ` · 入口: ${esc(c.entry)}` : ''}</div>
                ${c.imageFile ? `<img class="thumb" src="${esc(c.imageFile)}" alt="${esc(c.id)}" />` : ''}
              </td>
              <td class="cell-pred">
                <div>状态: <strong>${esc(stateLabel[c.expected.input_state] || c.expected.input_state)}</strong></div>
                <div>动作: <strong>${esc(actionLabel[c.expected.action] || c.expected.action)}</strong></div>
                ${c.expected.acceptable_categories ? `<div>品类: ${esc(c.expected.acceptable_categories.join(' / '))}</div>` : ''}
                <div class="ms">画面字:${c.expected.wants_rendered_text ? '是' : '否'} · 排除:${c.expected.has_exclusions ? '是' : '否'}</div>
              </td>
              ${summaries
                .map((s) => {
                  const r = c.runs[s.id];
                  if (!r) return `<td class="cell-pred" style="color:var(--muted)">仅纯文本<br>不参与看图</td>`;
                  if (!r.ok) return `<td class="cell-pred"><span class="badge b-err">失败</span><div class="ms">${esc(r.error)} (${r.latencyMs}ms)</div></td>`;
                  return `<td class="cell-pred">
                    <div>
                      <span class="badge ${r.coreRoutingMatch ? 'b-ok' : 'b-err'}">${r.coreRoutingMatch ? '路由准确' : '路由偏差'}</span>
                      <span class="ms">${r.latencyMs} ms</span>
                    </div>
                    <div style="margin-top:4px">状态: ${esc(stateLabel[r.input_state] || r.input_state)} ${r.stateMatch ? '✓' : '✗'}</div>
                    <div>动作: ${esc(actionLabel[r.action] || r.action)} ${r.actionMatch ? '✓' : '✗'}</div>
                    <div>品类: ${esc(r.category || '—')} ${r.categoryMatch ? '✓' : '✗'}</div>
                    <div class="ms">画面字:${r.wants_rendered_text ? '是' : '否'}${r.textFlagMatch ? '' : '(✗)'} · 排除:${r.has_exclusions ? '是' : '否'}${r.exclFlagMatch ? '' : '(✗)'}</div>
                  </td>`;
                })
                .join('')}
            </tr>`;
          })
          .join('')}
      </tbody>
    </table>
  </div>

  <script>
    const btns = document.querySelectorAll('.filter-btn');
    const rows = document.querySelectorAll('#detail-table tbody tr');
    btns.forEach(btn => {
      btn.addEventListener('click', () => {
        btns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const g = btn.getAttribute('data-group');
        rows.forEach(row => {
          if (g === 'ALL') row.style.display = '';
          else if (g === 'DIFF') row.style.display = row.getAttribute('data-diff') === '1' ? '' : 'none';
          else row.style.display = row.getAttribute('data-group') === g ? '' : 'none';
        });
      });
    });
  </script>
</body>
</html>`;

fs.writeFileSync(outHtmlPath, html, 'utf8');
console.log('✅ 可视化 HTML 报告已生成:', outHtmlPath);
