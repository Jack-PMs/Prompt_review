import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const source = new URL('../docs/prompt-review-prd.md', import.meta.url);
const destination = new URL('../docs/prompt-review-prd.html', import.meta.url);
const markdown = readFileSync(source, 'utf8');
const version = markdown.match(/^版本 (V[\d.]+)/m)?.[1] || 'V1.1';
const docDate = (() => { const m = markdown.match(/^版本 V[\d.]+\s+(\d{4}) 年 (\d{1,2}) 月 (\d{1,2}) 日/m); return m ? m[1] + '.' + m[2].padStart(2,'0') + '.' + m[3].padStart(2,'0') : ''; })();
const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const inline = value => escape(value).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
const lines = markdown.split(/\r?\n/);
const sections = [];
const body = [];
let sectionOpen = false;
let codeCount = 0;
let title = '';

function renderCode(value, language, label) {
  const id = 'code-' + (++codeCount);
  return '<div class="code-block"><div class="code-toolbar"><span>' + escape(label || language.toUpperCase()) + '</span><button class="copy-code" type="button" data-copy="' + id + '" aria-label="复制请求或响应">复制</button></div><pre tabindex="0" aria-label="' + escape(label || language) + '"><code id="' + id + '">' + escape(value) + '</code></pre></div>';
}

function readEvidence() {
  return JSON.parse(readFileSync(new URL('../docs/prompt-review-api-cases.json', import.meta.url), 'utf8'));
}

function fullModelRequest(item, call) {
  const request = structuredClone(call.request_body);
  for (const message of request.input) {
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (part.type !== 'input_image' || !part.image_url.startsWith('[IMAGE:')) continue;
      const unit = item.response.body.units.find(unit => unit.unit_id === call.unit_id);
      const asset = item.response.body.assets.find(asset => asset.id === unit?.asset_id);
      const imageIndex = Number(call.unit_id.replace('img_', '')) - 1;
      const image = item.request.body.images[imageIndex];
      const bytes = Buffer.from(image.split(',')[1], 'base64');
      if (!asset || createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw new Error('图片原件与审核记录不一致');
      part.image_url = 'data:' + asset.mime + ';base64,' + bytes.toString('base64');
    }
  }
  return request;
}

function renderRealCases() {
  const evidence = readEvidence();
  const cases = evidence.cases;
  if (cases.length < 3 || cases.some(item => item.response.body.provider_mode !== 'live' || item.upstream_successful_calls < 1)) throw new Error('真实案例记录不完整');
  const calls = cases.flatMap(item => item.response.body.api_calls.filter(call => call.sent).map(call => ({item,call,request:fullModelRequest(item,call)})));
  const rows = calls.map(({item,call}) => '<tr><td>' + escape(item.name) + (call.unit_id==='prompt'?' · 文字':' · 图片') + '</td><td>' + escape(call.request_body.model) + '</td><td>HTTP ' + call.status + '</td><td>' + call.latency_ms + ' ms</td></tr>').join('');
  const details = calls.map(({item,call,request},index) => {
    const name = item.name + (call.unit_id==='prompt'?' · 文字':' · 图片');
    const headers = call.method + ' ' + call.url + '\n' + Object.entries(call.request_headers).map(([key,value])=>key+': '+value).join('\n');
    return '<details class="api-case model-api-case"' + (index===0?' open':'') + '><summary><span>' + (index+1) + ' ' + escape(name) + '</span><span class="case-result">HTTP ' + call.status + ' · ' + call.latency_ms + ' ms</span></summary><div class="case-body">' + renderCode(headers,'http','供应商地址与请求头') + renderCode(JSON.stringify(request,null,2),'json','实际模型请求体 · 完整 model / input / questions') + renderCode(call.response_body ?? '', 'json','供应商原始响应 · HTTP '+call.status) + '</div></details>';
  }).join('');
  const providerEvidence = { timezone:evidence.recorded_timezone, calls:calls.map(({item,call,request})=>({case:item.name,requested_at:item.requested_at,task_id:item.response.body.task_id,method:call.method,url:call.url,request_headers:call.request_headers,request_body:request,status:call.status,response_body:call.response_body,latency_ms:call.latency_ms,unit_id:call.unit_id})) };
  writeFileSync(new URL('../docs/prompt-review-model-api-cases.json', import.meta.url), JSON.stringify(providerEvidence,null,2));
  const download = 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(providerEvidence,null,2));
  const times = cases.map(item=>new Date(item.requested_at)).sort((a,b)=>a-b);
  const format = date => date.toLocaleString('zh-CN', {timeZone:'Asia/Shanghai',hour12:false});
  return '<p class="case-meta">采集时间：' + escape(format(times[0])) + ' — ' + escape(format(times.at(-1))) + '（Asia/Shanghai）<br>模型供应商：https://api.looprouter.com/v1/decisions<br>实际模型请求：' + calls.length + ' 次 · 模式：live</p><div class="table-wrap"><table><thead><tr><th>案例</th><th>请求模型</th><th>供应商响应</th><th>单次模型耗时</th></tr></thead><tbody>' + rows + '</tbody></table></div><p class="case-meta">请求体包含完整审核指令和全部问题，响应保留供应商原文。密钥已打码；图片为本次提交且经素材哈希核对的同一 PNG。<a href="' + download + '" download="prompt-review-model-api-cases.json">模型请求与原始响应 JSON</a></p>' + details;
}

function renderLocalExample() {
  const item = readEvidence().cases[0];
  const task = item.response.body;
  const request = item.request.method + ' ' + item.request.url + '?wait=1\n' + Object.entries(item.request.headers).map(([key,value])=>key+': '+value).join('\n') + '\n\n' + JSON.stringify(item.request.body,null,2);
  const sampleView = {
    task_id: task.task_id,
    provider_mode: task.provider_mode,
    model: task.model,
    policy_version: task.policy_version,
    execution_status: task.execution_status,
    action: task.action,
    block_message: task.action === 'BLOCK' ? '该提示词可能涉及版权角色 / IP，建议修改（可能影响生成结果）' : null,
    block_messages: task.action === 'BLOCK' ? ['该提示词可能涉及版权角色 / IP，建议修改（可能影响生成结果）'] : [],
    reason_codes: task.reason_codes,
    latency_ms: task.latency_ms,
    error: task.error,
  };
  return renderCode(request,'http','本地任务请求（支持 ?wait=1 同步返回）') + renderCode(JSON.stringify(sampleView,null,2),'json','本地任务响应 · 关键字段');
}

/** 将超长的图片 data URL 缩写，避免 Markdown 源文件被 base64 撑爆；完整内容保留在 JSON 证据文件中。 */
function shortenDataUrls(value) {
  return JSON.parse(JSON.stringify(value), (_key, v) => typeof v === 'string' && v.startsWith('data:') && v.length > 200
    ? v.slice(0, v.indexOf(',') + 1) + '…（已省略 ' + v.length.toLocaleString('en-US') + ' 字符，完整内容见 prompt-review-model-api-cases.json）'
    : v);
}

/** 生成可在任意 Markdown 预览器中直接阅读的真实模型请求/响应章节。 */
function markdownRealCases() {
  const evidence = readEvidence();
  const calls = evidence.cases.flatMap(item => item.response.body.api_calls.filter(call => call.sent).map(call => ({item,call,request:fullModelRequest(item,call)})));
  const times = evidence.cases.map(item => new Date(item.requested_at)).sort((a,b) => a-b);
  const format = date => date.toLocaleString('zh-CN', {timeZone:'Asia/Shanghai',hour12:false});
  const out = [
    '采集时间：' + format(times[0]) + ' — ' + format(times.at(-1)) + '（Asia/Shanghai）；模型供应商：https://api.looprouter.com/v1/decisions；实际模型请求 ' + calls.length + ' 次，模式 live。',
    '',
    '| 案例 | 请求模型 | 供应商响应 | 单次模型耗时 |',
    '| --- | --- | --- | --- |',
    ...calls.map(({item,call}) => '| ' + item.name + (call.unit_id==='prompt'?' · 文字':' · 图片') + ' | ' + call.request_body.model + ' | HTTP ' + call.status + ' | ' + call.latency_ms + ' ms |'),
    '',
    '请求体包含完整审核指令和全部问题，响应保留供应商原文；密钥已打码，图片 base64 在本文中省略，完整内容见 [prompt-review-model-api-cases.json](prompt-review-model-api-cases.json)。',
  ];
  calls.forEach(({item,call,request}, index) => {
    const headers = call.method + ' ' + call.url + '\n' + Object.entries(call.request_headers).map(([k,v]) => k + ': ' + v).join('\n');
    let response = call.response_body ?? '';
    try { response = JSON.stringify(JSON.parse(response), null, 2); } catch { /* 保留原文 */ }
    out.push('', '### 1.' + (index+1) + ' ' + item.name + (call.unit_id==='prompt'?' · 文字':' · 图片') + '（HTTP ' + call.status + ' · ' + call.latency_ms + ' ms）', '',
      '```http', headers, '```', '', '```json', JSON.stringify(shortenDataUrls(request), null, 2), '```', '', '```json', response, '```');
  });
  return out.join('\n');
}

/** 生成本地任务请求与响应示例的 Markdown 版本。 */
function markdownLocalExample() {
  const item = readEvidence().cases[0];
  const task = item.response.body;
  const request = item.request.method + ' ' + item.request.url + '?wait=1\n' + Object.entries(item.request.headers).map(([k,v]) => k + ': ' + v).join('\n') + '\n\n' + JSON.stringify(shortenDataUrls(item.request.body), null, 2);
  const message = '该提示词可能涉及版权角色 / IP，建议修改（可能影响生成结果）';
  const view = {task_id:task.task_id,provider_mode:task.provider_mode,model:task.model,policy_version:task.policy_version,execution_status:task.execution_status,action:task.action,
    block_message:task.action==='BLOCK'?message:null,block_messages:task.action==='BLOCK'?[message]:[],reason_codes:task.reason_codes,latency_ms:task.latency_ms,error:task.error};
  return ['```http', request, '```', '', '```json', JSON.stringify(view, null, 2), '```'].join('\n');
}

/** 把 Markdown 中的占位符（或上一次生成的区块）替换为最新的可读内容，并写回源文件。 */
function syncMarkdownBlocks(text) {
  const blocks = { 'real-api-cases': markdownRealCases, 'local-api-example': markdownLocalExample };
  let next = text;
  for (const [name, build] of Object.entries(blocks)) {
    const begin = '<!-- ' + name + ':begin -->', end = '<!-- ' + name + ':end -->';
    const block = begin + '\n\n' + build() + '\n\n' + end;
    const pattern = new RegExp(begin.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + '[\\s\\S]*?' + end.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
    next = pattern.test(next) ? next.replace(pattern, () => block) : next.replace(':::' + name, () => block);
  }
  return next;
}

const syncedMarkdown = syncMarkdownBlocks(markdown);
if (syncedMarkdown !== markdown) writeFileSync(source, syncedMarkdown);
lines.splice(0, lines.length, ...syncedMarkdown.split(/\r?\n/));
const blockRenderers = { 'real-api-cases': renderRealCases, 'local-api-example': renderLocalExample };

for (let i = 0; i < lines.length;) {
  const line = lines[i];
  if (!line.trim()) { i++; continue; }
  const beginMatch = line.trim().match(/^<!-- ([\w-]+):begin -->$/);
  if (beginMatch && blockRenderers[beginMatch[1]]) {
    body.push(blockRenderers[beginMatch[1]]());
    while (i < lines.length && lines[i].trim() !== '<!-- ' + beginMatch[1] + ':end -->') i++;
    i++;
    continue;
  }
  if (line.startsWith('```')) {
    const language = line.slice(3).trim() || 'text';
    const code = [];
    i++;
    while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++]);
    const id = 'code-' + (++codeCount);
    body.push('<div class="code-block"><div class="code-toolbar"><span>' + escape(language.toUpperCase()) + '</span><button class="copy-code" type="button" data-copy="' + id + '" aria-label="复制代码示例">复制</button></div><pre tabindex="0" aria-label="' + escape(language) + ' 示例"><code id="' + id + '">' + escape(code.join('\n')) + '</code></pre></div>');
    i++;
    continue;
  }
  if (line.startsWith('|')) {
    const rows = [];
    while (i < lines.length && lines[i].startsWith('|')) {
      const cells = lines[i++].trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
      if (!cells.every(cell => /^:?-+:?$/.test(cell.replaceAll(' ', '')))) rows.push(cells);
    }
    const [header, ...rowsBody] = rows;
    const wide = header[0] === '用例' ? ' acceptance-table' : '';
    body.push('<div class="table-wrap" role="region" aria-label="' + escape(header.join('与')) + '表" tabindex="0"><table class="' + wide.trim() + '"><thead><tr>' + header.map(cell => '<th scope="col">' + inline(cell) + '</th>').join('') + '</tr></thead><tbody>' + rowsBody.map(row => '<tr>' + row.map((cell, index) => '<td' + (index === 0 ? ' class="row-label"' : '') + '>' + inline(cell) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>');
    continue;
  }
  if (line.startsWith('# ')) {
    title = line.slice(2);
    body.push('<h1>' + inline(title) + '</h1>');
    i++;
    continue;
  }
  if (line.startsWith('## ')) {
    if (sectionOpen) body.push('</section>');
    const heading = line.slice(3);
    const number = heading.match(/^\d+/)?.[0] || String(sections.length + 1);
    const id = 'section-' + number;
    sections.push({ id, heading });
    body.push('<section class="doc-section" id="' + id + '" aria-labelledby="heading-' + number + '"><h2 id="heading-' + number + '">' + inline(heading) + '</h2>');
    sectionOpen = true;
    i++;
    continue;
  }
  if (line.startsWith('### ')) {
    const heading = line.slice(4);
    const id = 'subsection-' + (heading.match(/^[\d.]+/)?.[0].replaceAll('.', '-') || i);
    body.push('<h3 id="' + id + '">' + inline(heading) + '</h3>');
    i++;
    continue;
  }
  const paragraph = [line];
  i++;
  while (i < lines.length && lines[i].trim() && !/^(#|\||```|<!-- [\w-]+:begin -->)/.test(lines[i])) paragraph.push(lines[i++]);
  const text = paragraph.join(' ');
  const requirement = text.match(/^(FR\d+) (P\d)：(.*)$/s);
  if (requirement) {
    body.push('<p class="requirement" id="' + requirement[1].toLowerCase() + '"><span class="requirement-id">' + requirement[1] + '</span> <span class="priority">' + requirement[2] + '</span>：' + inline(requirement[3]) + '</p>');
  } else {
    body.push('<p' + (/^(版本 V|业务方 三笙)/.test(text) ? ' class="document-meta"' : '') + '>' + inline(text) + '</p>');
  }
}
if (sectionOpen) body.push('</section>');

const navigation = sections.map(({ id, heading }) => '<a href="#' + id + '" data-section="' + id + '">' + inline(heading) + '</a>').join('\n');

const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="提示词审核功能需求：当前 Demo 功能、线上要求、后台框架、API 请求响应示例及验收标准。">
  <meta name="color-scheme" content="light">
  <title>${escape(title)} ${escape(version)}</title>
  <style>
    :root { --ink:#172b3d; --muted:#536578; --accent:#176468; --line:#dce4e8; --paper:#fff; --canvas:#f7f9fa; --soft:#edf5f4; --code:#f4f6f8; }
    * { box-sizing:border-box; }
    html { scroll-padding-top:96px; }
    body { margin:0; color:var(--ink); background:var(--paper); font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif; font-size:16px; line-height:1.9; -webkit-font-smoothing:antialiased; }
    a { color:var(--accent); text-decoration-thickness:1px; text-underline-offset:3px; }
    button,input { font:inherit; }
    button { cursor:pointer; }
    :focus-visible { outline:3px solid var(--accent); outline-offset:4px; }
    .skip-link { position:fixed; top:-80px; left:20px; z-index:10; padding:8px 18px; color:var(--paper); background:var(--ink); }
    .skip-link:focus { top:12px; }
    .topbar { height:72px; padding:0 36px; display:flex; align-items:center; justify-content:space-between; gap:16px; position:fixed; inset:0 0 auto; z-index:5; background:var(--paper); border-bottom:1px solid var(--line); }
    .brand { display:flex; align-items:center; gap:15px; min-width:0; color:var(--ink); text-decoration:none; }
    .brand strong { font-size:19px; letter-spacing:.02em; white-space:nowrap; }
    .brand span { padding-left:15px; border-left:1px solid var(--line); color:var(--muted); font-size:14px; }
    .toolbar { display:flex; align-items:center; gap:12px; }
    .toolbar small { color:var(--muted); font-size:13px; }
    .button { display:inline-flex; align-items:center; justify-content:center; min-height:44px; padding:7px 17px; border:1px solid var(--line); border-radius:7px; background:var(--paper); color:var(--ink); font-size:14px; transition:background .16s,border-color .16s; }
    .button:hover { background:var(--canvas); border-color:var(--muted); }
    .menu-toggle { display:none; }
    .layout { display:grid; grid-template-columns:248px minmax(0,880px); gap:58px; max-width:1296px; padding:112px 34px 90px; margin:auto; align-items:start; }
    .sidebar { position:sticky; top:102px; max-height:calc(100dvh - 128px); overflow-y:auto; scrollbar-width:thin; padding:0 14px 12px 0; }
    .sidebar-heading { margin:0 0 12px; display:flex; justify-content:space-between; align-items:center; color:var(--muted); font-size:13px; font-weight:600; }
    .sidebar-heading span { font-weight:400; }
    .section-search { width:100%; min-height:44px; margin-bottom:14px; padding:9px 12px; border:1px solid var(--line); border-radius:6px; background:var(--canvas); color:var(--ink); font-size:14px; }
    .section-search::placeholder { color:var(--muted); opacity:1; }
    .toc a { display:block; min-height:44px; padding:8px 11px; margin:2px 0; border-left:2px solid transparent; border-radius:0 5px 5px 0; color:var(--muted); text-decoration:none; font-size:14px; line-height:1.7; }
    .toc a:hover { color:var(--ink); background:var(--canvas); }
    .toc a[aria-current="location"] { color:var(--accent); background:var(--soft); border-left-color:var(--accent); font-weight:600; }
    .toc a[hidden] { display:none; }
    .no-sections { margin:12px 0; color:var(--muted); font-size:13px; }
    .sidebar-note { margin-top:20px; padding-top:16px; border-top:1px solid var(--line); color:var(--muted); font-size:12px; line-height:1.8; }
    main { min-width:0; }
    .document-label { margin:0 0 12px; color:var(--accent); font-size:13px; font-weight:600; letter-spacing:.09em; }
    h1 { font-size:clamp(27px,3.1vw,38px); line-height:1.45; margin:0 0 20px; font-weight:700; letter-spacing:-.025em; }
    h2 { margin:0 0 20px; font-size:25px; line-height:1.5; letter-spacing:-.02em; }
    h3 { margin:30px 0 14px; font-size:19px; line-height:1.6; }
    p { margin:0 0 18px; overflow-wrap:anywhere; }
    .document-meta { color:var(--muted); font-size:14px; line-height:1.8; margin-bottom:8px; }
    .document-meta + p:not(.document-meta) { margin-top:27px; }
    .doc-section { padding-top:38px; margin-top:38px; border-top:1px solid var(--line); }
    .requirement-id { color:var(--accent); font-weight:650; font-variant-numeric:tabular-nums; }
    .priority { display:inline-block; font-size:11px; font-weight:650; line-height:1.7; padding:0 5px; border:1px solid #bdd8d4; border-radius:4px; color:#165651; background:var(--soft); vertical-align:1px; }
    .table-wrap { width:100%; margin:22px 0 26px; overflow-x:auto; border:1px solid var(--line); border-radius:7px; }
    table { width:100%; border-spacing:0; border-collapse:collapse; font-size:14px; line-height:1.8; text-align:left; }
    th,td { padding:13px 15px; vertical-align:top; border-bottom:1px solid var(--line); overflow-wrap:anywhere; }
    th { font-weight:600; background:var(--canvas); color:var(--ink); }
    td + td, th + th { border-left:1px solid var(--line); }
    tbody tr:last-child td { border-bottom:0; }
    tbody tr:nth-child(even) { background:#fbfcfd; }
    .row-label { min-width:78px; font-weight:550; }
    .acceptance-table th:first-child,.acceptance-table td:first-child { width:74px; white-space:nowrap; }
    .acceptance-table th:nth-child(2) { width:44%; }
    code { font-family:ui-monospace,SFMono-Regular,Consolas,monospace; font-size:.88em; background:var(--code); border-radius:3px; padding:2px 4px; }
    .code-block { margin:22px 0 26px; border:1px solid var(--line); border-radius:8px; overflow:hidden; }
    .code-toolbar { display:flex; align-items:center; justify-content:space-between; min-height:47px; padding:0 8px 0 18px; border-bottom:1px solid var(--line); background:var(--canvas); color:var(--muted); font-size:11px; letter-spacing:.06em; }
    .copy-code { min-width:56px; min-height:44px; padding:7px 10px; border:0; background:transparent; color:var(--accent); font-size:13px; border-radius:5px; }
    .copy-code:hover { background:var(--soft); }
    pre { margin:0; padding:20px; overflow:auto; background:var(--canvas); line-height:1.8; tab-size:2; }
    pre code { display:block; padding:0; border:0; border-radius:0; background:none; font-size:13px; line-height:1.8; }
    .document-end { margin-top:44px; padding-top:22px; border-top:1px solid var(--line); color:var(--muted); font-size:13px; }
    .case-meta,.case-query { color:var(--muted); font-size:13px; line-height:1.8; }
    .api-case { margin:12px 0; border:1px solid var(--line); border-radius:7px; }
    .api-case summary { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:15px 18px; cursor:pointer; font-size:14px; font-weight:600; }
    .api-case summary::before { content:'+'; color:var(--accent); font-size:19px; font-weight:400; }
    .api-case[open] summary::before { content:'−'; }
    .api-case summary > span:first-of-type { flex:1; }
    .case-result { color:var(--muted); font-size:12px; font-weight:400; white-space:nowrap; }
    .case-body { padding:0 18px 6px; border-top:1px solid var(--line); }
    .model-api-case pre { max-height:36rem; }
    .model-api-case pre code { white-space:pre-wrap; overflow-wrap:anywhere; }
    .backdrop { display:none; }
    .sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
    @media (max-width:1000px) {
      .topbar { padding:0 22px; }
      .layout { display:block; max-width:920px; padding:105px 26px 64px; }
      .sidebar { position:fixed; top:72px; bottom:0; left:0; width:min(340px,87vw); max-height:none; z-index:7; padding:24px; background:var(--paper); border-right:1px solid var(--line); transform:translateX(-105%); transition:transform .18s ease; }
      body.menu-open .sidebar { transform:translateX(0); }
      body.menu-open { overflow:hidden; }
      .menu-toggle { display:inline-flex; }
      body.menu-open .backdrop { display:block; position:fixed; inset:72px 0 0; background:rgba(18,36,50,.28); border:0; padding:0; z-index:6; }
      .toolbar small { display:none; }
    }
    @media (max-width:560px) {
      body { font-size:16px; }
      .topbar { height:64px; padding:0 16px; }
      .brand span { display:none; }
      .brand strong { font-size:17px; }
      .toolbar { gap:8px; }
      .button { padding:7px 12px; }
      .layout { padding:91px 18px 48px; }
      .sidebar { top:64px; }
      body.menu-open .backdrop { top:64px; }
      h1 { font-size:28px; }
      h2 { font-size:22px; }
      h3 { font-size:18px; }
      .doc-section { padding-top:28px; margin-top:29px; }
      table { min-width:620px; }
      th,td { padding:11px 12px; }
      pre { padding:16px; }
    }
    @media (prefers-reduced-motion:reduce) { *,*::before,*::after { transition:none !important; scroll-behavior:auto !important; } }
    @media print {
      @page { size:A4; margin:16mm; }
      html { scroll-padding:0; }
      body { font-size:10.5pt; line-height:1.65; color:#111; }
      .topbar,.sidebar,.backdrop,.document-label,.document-end,.copy-code,.skip-link { display:none !important; }
      .layout { display:block; max-width:none; margin:0; padding:0; }
      h1 { font-size:23pt; } h2 { font-size:16pt; } h3 { font-size:12pt; }
      h1,h2,h3 { break-after:avoid; }
      .doc-section { border:0; margin-top:24pt; padding-top:0; }
      .table-wrap,.code-block { overflow:visible; border-radius:0; }
      table { min-width:0; font-size:9pt; }
      thead { display:table-header-group; }
      tr { break-inside:avoid; }
      th,td { padding:7px 8px; }
      pre { white-space:pre-wrap; overflow-wrap:anywhere; }
      pre code { font-size:8.8pt; }
      .priority { background:none; }
      a { color:inherit; }
    }
  </style>
</head>
<body id="top">
  <a class="skip-link" href="#document">跳到需求正文</a>
  <header class="topbar">
    <a class="brand" href="#top" aria-label="三笙 AI 需求文档首页"><strong>三笙 AI</strong><span>提示词审核 · 开发需求</span></a>
    <div class="toolbar"><small>${escape(version)}${docDate ? ' · ' + docDate : ''}</small><button class="button menu-toggle" id="menu-toggle" type="button" aria-controls="sidebar" aria-expanded="false">目录</button></div>
  </header>
  <button class="backdrop" id="backdrop" type="button" aria-label="关闭目录"></button>
  <div class="layout">
    <aside class="sidebar" id="sidebar" aria-label="文档目录">
      <p class="sidebar-heading">文档目录 <span>${sections.length} 个章节</span></p>
      <nav class="toc" aria-label="章节导航">${navigation}</nav>
    </aside>
    <main id="document" tabindex="-1"><article>${body.join('\n')}</article></main>
  </div>
  <script>
    (() => {
      const menu = document.getElementById('menu-toggle');
      const sidebar = document.getElementById('sidebar');
      const links = Array.from(document.querySelectorAll('.toc a'));
      const sections = Array.from(document.querySelectorAll('.doc-section'));
      const mobile = window.matchMedia('(max-width:1000px)');
      const setMenu = open => {
        document.body.classList.toggle('menu-open', open);
        menu.setAttribute('aria-expanded', String(open));
        sidebar.inert = mobile.matches && !open;
        document.getElementById('document').inert = mobile.matches && open;
      };
      setMenu(false);
      menu.addEventListener('click', () => { const open = menu.getAttribute('aria-expanded') !== 'true'; setMenu(open); if (open) links[0]?.focus(); });
      document.getElementById('backdrop').addEventListener('click', () => { setMenu(false); menu.focus(); });
      document.addEventListener('keydown', event => { if (event.key === 'Escape' && menu.getAttribute('aria-expanded') === 'true') { setMenu(false); menu.focus(); } });
      mobile.addEventListener('change', () => setMenu(false));
      links.forEach(link => link.addEventListener('click', () => { if (mobile.matches) { setMenu(false); document.getElementById('document').focus({ preventScroll:true }); } }));
      let scheduled = false;
      const updateActive = () => { let id = sections[0]?.id; for (const section of sections) { if (section.getBoundingClientRect().top <= 150) id = section.id; } links.forEach(link => { if (link.dataset.section === id) link.setAttribute('aria-current','location'); else link.removeAttribute('aria-current'); }); scheduled = false; };
      document.addEventListener('scroll', () => { if (!scheduled) { scheduled = true; requestAnimationFrame(updateActive); } }, { passive:true });
      updateActive();
      document.querySelectorAll('[data-copy]').forEach(button => button.addEventListener('click', async () => {
        const text = document.getElementById(button.dataset.copy).textContent;
        try {
          try { await navigator.clipboard.writeText(text); }
          catch {
            const textarea = document.createElement('textarea'); textarea.value = text; textarea.style.position = 'fixed'; textarea.style.opacity = '0'; document.body.append(textarea); textarea.select();
            const copied = document.execCommand('copy'); textarea.remove(); button.focus(); if (!copied) throw new Error('copy');
          }
          button.textContent = '已复制';
        } catch { button.textContent = '请选中复制'; }
        window.setTimeout(() => { button.textContent = '复制'; }, 2000);
      }));
    })();
  </script>
</body>
</html>`;

writeFileSync(destination, html);
console.log(JSON.stringify({ output:fileURLToPath(destination), sections:sections.length, codeBlocks:codeCount, bytes:Buffer.byteLength(html) }));
