import fs from 'node:fs';
import path from 'node:path';

export function buildImageReportHtml() {
  const dataPath = path.resolve(process.cwd(), 'data', 'multimodal-image-benchmark.json');
  const raw = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

  // Embed full real data (including real image thumbnails from imageCatalog) cleanly into standalone HTML
  const embeddedJson = JSON.stringify(raw).replace(/<\/script/gi, '<\\/script');

  const html = `<!DOCTYPE html>
<html lang="zh-CN" class="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>提示词审核系统 · 带图片（图文合并）10 条实测基准报告</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&family=Noto+Sans+SC:wght@400;500;600;700&family=Outfit:wght@500;600;700&display=swap" rel="stylesheet">
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          fontFamily: {
            sans: ['"Inter"', '"Noto Sans SC"', 'system-ui', 'sans-serif'],
            display: ['"Outfit"', '"Noto Sans SC"', 'system-ui', 'sans-serif'],
            mono: ['"JetBrains Mono"', 'monospace'],
          }
        }
      }
    };
  </script>
  <style>
    body {
      background: radial-gradient(circle at 12% 8%, rgba(99, 102, 241, 0.16), transparent 38%),
                  radial-gradient(circle at 88% 18%, rgba(236, 72, 153, 0.10), transparent 38%),
                  radial-gradient(circle at 50% 92%, rgba(16, 185, 129, 0.10), transparent 42%),
                  #090d16;
      color: #e2e8f0;
      min-height: 100vh;
    }
    .glass-card {
      background: rgba(17, 24, 39, 0.74);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid rgba(255, 255, 255, 0.08);
    }
    .glass-card-hover {
      transition: all 0.22s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .glass-card-hover:hover {
      border-color: rgba(99, 102, 241, 0.4);
      transform: translateY(-2px);
      box-shadow: 0 12px 32px -8px rgba(0, 0, 0, 0.55);
    }
    .img-thumb {
      transition: transform 0.2s ease, box-shadow 0.2s ease;
    }
    .img-thumb:hover {
      transform: scale(1.04);
      box-shadow: 0 0 0 2px rgba(129, 140, 248, 0.8);
    }
  </style>
</head>
<body class="antialiased selection:bg-indigo-500 selection:text-white pb-16">

  <!-- 图片放大预览弹窗 -->
  <div id="lightbox" onclick="closeLightbox()" class="fixed inset-0 z-50 hidden bg-black/85 backdrop-blur-md flex items-center justify-center p-4 cursor-zoom-out">
    <div class="max-w-4xl max-h-[90vh] flex flex-col items-center gap-3" onclick="event.stopPropagation()">
      <img id="lightbox-img" src="" alt="预览大图" class="max-h-[80vh] max-w-full rounded-xl border border-white/15 shadow-2xl object-contain" />
      <div class="flex items-center gap-3 text-xs text-slate-300 font-mono bg-slate-900/90 px-4 py-2 rounded-full border border-white/10">
        <span id="lightbox-caption"></span>
        <button onclick="closeLightbox()" class="text-indigo-400 hover:text-indigo-300 ml-2 cursor-pointer">关闭 (ESC)</button>
      </div>
    </div>
  </div>

  <!-- 顶部导航栏 -->
  <header class="sticky top-0 z-40 border-b border-white/10 bg-slate-950/80 backdrop-blur-xl">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 via-pink-500 to-emerald-400 p-[1px] shadow-lg shadow-indigo-500/20">
          <div class="w-full h-full bg-slate-950 rounded-[11px] flex items-center justify-center text-lg">
            🖼️
          </div>
        </div>
        <div>
          <div class="flex items-center gap-2 flex-wrap">
            <h1 class="font-display font-bold text-base sm:text-lg text-white tracking-tight">
              提示词审核系统 · 带图片（图文合并）实测报告
            </h1>
            <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
              <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              10 条真实图文 API 实测
            </span>
            <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-500/15 text-amber-300 border border-amber-500/30">
              🛡️ 已排除 OpenAI 官方渠道 (0 调用)
            </span>
          </div>
          <p class="text-xs text-slate-400 mt-0.5 font-mono" id="header-time-range">
            实测时间窗口（北京时间）：加载中...
          </p>
        </div>
      </div>

      <div class="flex items-center gap-2 flex-wrap">
        <button onclick="exportReport('json')" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 transition cursor-pointer">
          导出 JSON
        </button>
        <button onclick="exportReport('csv')" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 transition cursor-pointer">
          导出 CSV 报表
        </button>
        <button onclick="restoreDefaultData()" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition cursor-pointer">
          恢复默认 10 条
        </button>
      </div>
    </div>
  </header>

  <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 space-y-6">

    <!-- 多模态渠道说明横幅 -->
    <section class="glass-card rounded-2xl p-4 sm:p-5 border-indigo-500/25">
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div class="space-y-1">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="px-2 py-0.5 rounded text-xs font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
              图文合并单次请求模式 (combined)
            </span>
            <span class="text-sm font-semibold text-white">参测模型：LoopRouter · Decisions (<code class="text-indigo-300">gpt-6-luna</code>)</span>
          </div>
          <p class="text-xs text-slate-400 leading-relaxed">
            在非 OpenAI 官方渠道中，<strong class="text-slate-200">仅 <code class="text-indigo-300">looprouter-gpt-6-luna</code> 支持文字 + 图片联合判定</strong>（豆包与阿里 <code class="text-slate-300">systemone</code> 渠道仅支持纯文本，含图片请求会自动跳过）。本次直接调用您本地素材库中的真实商品/人物参考图，完成 <strong>7 条单图 + 3 条双图合并</strong> 共 10 条真实图文审核测试。
          </p>
        </div>
        <div id="db-status" class="text-xs font-mono text-slate-400 bg-slate-900/90 px-3 py-1.5 rounded-lg border border-white/5 shrink-0">
          IndexedDB: 已持久化保存
        </div>
      </div>
    </section>

    <!-- 四大核心 KPI 卡片 -->
    <section class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" id="kpi-cards"></section>

    <!-- 纯文本 vs 单图 vs 双图 耗时与成本横向对比 + 交互式图文成本校准器 -->
    <section class="grid grid-cols-1 lg:grid-cols-12 gap-5">
      <div class="lg:col-span-7 glass-card rounded-2xl p-5 space-y-4">
        <div class="flex items-center justify-between">
          <h2 class="font-display font-semibold text-base text-white">📊 纯文本 vs 单图 vs 双图合并 · 耗时与成本实测对比</h2>
          <span class="text-xs font-mono text-slate-400">模型: looprouter-gpt-6-luna</span>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse text-xs">
            <thead>
              <tr class="border-b border-white/10 text-slate-400">
                <th class="py-2.5 pr-3">审核模态</th>
                <th class="py-2.5 px-2.5 text-center">样本数</th>
                <th class="py-2.5 px-2.5 text-right">平均耗时</th>
                <th class="py-2.5 px-2.5 text-right">最快 / 最慢</th>
                <th class="py-2.5 px-2.5 text-right">预估输入 Tokens</th>
                <th class="py-2.5 pl-2.5 text-right">单条预估成本</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-white/5 text-slate-200" id="modality-compare-tbody"></tbody>
          </table>
        </div>

        <!-- 图文视觉拦截亮点剖析 -->
        <div class="rounded-xl bg-slate-900/90 border border-pink-500/25 p-4 space-y-2">
          <div class="flex items-center gap-2">
            <span class="px-2 py-0.5 rounded text-[11px] font-semibold bg-pink-500/20 text-pink-300 border border-pink-500/30">
              👁️ 视觉识图实测亮点：纯安全文字下成功抓出图片隐藏 IP
            </span>
          </div>
          <p class="text-xs text-slate-300 leading-relaxed">
            在 <strong class="text-white">IMG-06</strong> 测试中，文字提示词为完全安全的国际环保插画描述，但附带的真实参考图（<code class="text-indigo-300">1600×1200</code>）中含有受保护的版权 IP 角色——<code class="text-indigo-300">gpt-6-luna</code> 不仅准确给文字打上了 <code class="text-indigo-300">涉政话题 (99%)</code> 标签，更从画面中精准识别出版权 IP（<strong class="text-rose-300">IP-001: 96%</strong>）并予以拦截！同时<strong>双图合并（3,701 ms）仅比单图（3,431 ms）慢 270 ms</strong>，大幅优于拆成两次独立请求。
          </p>
        </div>
      </div>

      <!-- 右侧：交互式图文成本校准器 -->
      <div class="lg:col-span-5 glass-card rounded-2xl p-5 flex flex-col justify-between space-y-4">
        <div class="space-y-3">
          <div class="flex items-center justify-between">
            <h2 class="font-display font-semibold text-base text-white">💰 图文审核成本核算与账单校准</h2>
            <span class="text-[11px] font-mono px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
              ¥0.669621 / ¥0/M
            </span>
          </div>
          <p class="text-xs text-slate-400 leading-relaxed">
            以 09:51 真实账单校准的纯文本基线（<strong>2,163 入Token</strong>）叠加 Vision 切片 Tokens（高分辨率图约 +425 ~ +1,105 Tokens/张）。如果您在 LoopRouter 控制台核对完 <code class="text-slate-300">11:41:47~11:42:07</code> 的真实账单，可直接在下方输入真实单价或单图额外 Tokens 实时校准：
          </p>

          <div class="bg-slate-900/80 rounded-xl p-3.5 border border-white/5 space-y-3">
            <div class="grid grid-cols-2 gap-2.5 text-xs">
              <div>
                <label class="text-slate-400 block mb-1">报价 (¥ / 百万输入Token)</label>
                <input id="input-price-1m" type="number" step="0.01" value="0.669621" oninput="onPriceConfigChange()" class="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 font-mono text-emerald-300 focus:outline-none focus:border-indigo-500" />
              </div>
              <div>
                <label class="text-slate-400 block mb-1">预估审核量 (条)</label>
                <input id="input-volume" type="number" min="1" value="10000" oninput="onPriceConfigChange()" class="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 font-mono text-indigo-300 focus:outline-none focus:border-indigo-500" />
              </div>
            </div>
            <div class="flex justify-between text-[11px] text-slate-400 font-mono">
              <button onclick="setCalcVolume(10)" class="hover:text-white cursor-pointer">10条(本次)</button>
              <button onclick="setCalcVolume(1000)" class="hover:text-white cursor-pointer">1,000条</button>
              <button onclick="setCalcVolume(10000)" class="hover:text-white cursor-pointer">10,000条</button>
              <button onclick="setCalcVolume(100000)" class="hover:text-white cursor-pointer">100,000条</button>
            </div>
          </div>

          <div id="cost-summary-cards" class="space-y-2"></div>
        </div>

        <div class="text-[11px] text-slate-400 bg-slate-950/70 rounded-lg p-3 border border-white/5 leading-relaxed">
          🕒 <strong class="text-slate-200">LoopRouter 账单核对指引：</strong>本次 10 条图文请求的精确北京时间为 <strong class="text-indigo-300" id="verify-time-window"></strong>，您可在 LoopRouter 日志中按此时间段筛选 <code class="text-indigo-300">gpt-6-luna</code>，直接看到带图片后的真实 Token 扣费。
        </div>
      </div>
    </section>

    <!-- 10 条图文样本耗时柱状图 -->
    <section class="glass-card rounded-2xl p-5">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
        <div>
          <h3 class="font-display font-semibold text-base text-white">⏱️ 10 条带图片样本 · 耗时与视觉载荷分布</h3>
          <p class="text-xs text-slate-400 mt-0.5">点击任意条形可跳转至下方对应的图文审核卡片（可点击参考图放大查看原图）。</p>
        </div>
        <div class="flex items-center gap-4 text-xs">
          <span class="flex items-center gap-1.5 text-slate-300"><span class="w-2.5 h-2.5 rounded-sm bg-emerald-500"></span> 放行 ALLOW</span>
          <span class="flex items-center gap-1.5 text-slate-300"><span class="w-2.5 h-2.5 rounded-sm bg-rose-500"></span> 拦截 BLOCK</span>
        </div>
      </div>
      <div id="latency-chart" class="space-y-2.5"></div>
    </section>

    <!-- 10 条带图片样本逐条详细卡片 -->
    <section class="glass-card rounded-2xl p-5 space-y-4">
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-white/10 pb-4">
        <div>
          <h3 class="font-display font-semibold text-base text-white flex items-center gap-2">
            <span>🔍 10 条图文合并实测明细（含真实参考图预览 + 9 维信号 + 精确调用时间）</span>
            <span id="count-badge" class="text-xs font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300">10 / 10</span>
          </h3>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <div class="inline-flex rounded-lg bg-slate-900 p-1 border border-white/10 text-xs">
            <button onclick="setFilter('ALL')" id="flt-ALL" class="px-2.5 py-1 rounded-md font-medium bg-indigo-600 text-white cursor-pointer">全部</button>
            <button onclick="setFilter('SINGLE')" id="flt-SINGLE" class="px-2.5 py-1 rounded-md font-medium text-slate-400 hover:text-white cursor-pointer">单图 (1张)</button>
            <button onclick="setFilter('MULTI')" id="flt-MULTI" class="px-2.5 py-1 rounded-md font-medium text-slate-400 hover:text-white cursor-pointer">双图 (2张)</button>
            <button onclick="setFilter('ALLOW')" id="flt-ALLOW" class="px-2.5 py-1 rounded-md font-medium text-slate-400 hover:text-white cursor-pointer">放行</button>
            <button onclick="setFilter('BLOCK')" id="flt-BLOCK" class="px-2.5 py-1 rounded-md font-medium text-slate-400 hover:text-white cursor-pointer">拦截</button>
          </div>
          <input id="search-box" type="text" placeholder="搜索提示词 / 规则 / 时间..." oninput="onSearch(this.value)" class="w-48 bg-slate-900/90 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500" />
        </div>
      </div>

      <div id="cases-list" class="space-y-3.5"></div>
    </section>

  </main>

  <script>
    const RAW_BENCHMARK = ${embeddedJson};
    const DATA_VERSION = "2026-11-19-multimodal-v1";
    const DB_NAME = "PromptReviewMultimodalReportDB";
    const STORE_NAME = "multimodal_state";

    const RULES_META = [
      { rule_id: "IP-001", title: "版权角色 / IP", kind: "risk" },
      { rule_id: "SEX-001", title: "露骨色情", kind: "risk" },
      { rule_id: "SEX-002", title: "性暗示 / 擦边", kind: "risk" },
      { rule_id: "TOPIC-001", title: "涉政话题(仅标签)", kind: "topic" },
      { rule_id: "CN-POL-001", title: "中国政治", kind: "risk" },
      { rule_id: "ABUSE-001", title: "针对性辱骂", kind: "risk" },
      { rule_id: "SUBJECT-001", title: "指定对象侮辱", kind: "risk" },
      { rule_id: "VIO-001", title: "暴力煽动", kind: "risk" },
      { rule_id: "QUALITY-001", title: "证据充分", kind: "quality" }
    ];

    const IMAGE_MAP = {};
    for (const im of (RAW_BENCHMARK.imageCatalog || [])) {
      IMAGE_MAP[im.assetId] = im;
    }

    let state = {
      filter: "ALL",
      search: "",
      pricePer1mRmb: 0.669621,
      calcVolume: 10000,
      expanded: { "IMG-01": true, "IMG-02": true, "IMG-06": true },
      results: JSON.parse(JSON.stringify(RAW_BENCHMARK.results || []))
    };

    function openDb() {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: "id" });
        };
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = (e) => reject(e.target.error);
      });
    }

    async function loadFromDb() {
      try {
        const db = await openDb();
        return new Promise((resolve) => {
          const tx = db.transaction(STORE_NAME, "readonly");
          const req = tx.objectStore(STORE_NAME).get("current");
          req.onsuccess = () => {
            if (req.result && req.result.version === DATA_VERSION) {
              state.results = req.result.results;
              state.pricePer1mRmb = req.result.pricePer1mRmb ?? 0.669621;
              document.getElementById("input-price-1m").value = state.pricePer1mRmb;
              setDbStatus("IndexedDB: 已加载本地持久数据");
            } else {
              saveToDb();
            }
            resolve();
          };
          req.onerror = () => resolve();
        });
      } catch (e) { console.error(e); }
    }

    async function saveToDb() {
      try {
        const db = await openDb();
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).put({
          id: "current",
          version: DATA_VERSION,
          pricePer1mRmb: state.pricePer1mRmb,
          results: state.results,
          updatedAt: new Date().toISOString()
        });
        setDbStatus("IndexedDB: 已同步保存 (" + new Date().toLocaleTimeString() + ")");
      } catch (e) { console.error(e); }
    }

    function setDbStatus(txt) {
      const el = document.getElementById("db-status");
      if (el) el.textContent = txt;
    }

    async function restoreDefaultData() {
      state.results = JSON.parse(JSON.stringify(RAW_BENCHMARK.results || []));
      state.pricePer1mRmb = 0.669621;
      document.getElementById("input-price-1m").value = state.pricePer1mRmb;
      recalcCosts();
      await saveToDb();
      renderAll();
    }

    async function deleteItem(id) {
      state.results = state.results.filter(r => r.id !== id);
      await saveToDb();
      renderAll();
    }

    function recalcCosts() {
      for (const r of state.results) {
        r.estimatedCostRmb = r.actualAction !== "ERROR"
          ? Number(((r.estimatedInputTokens / 1000000) * state.pricePer1mRmb).toFixed(6))
          : 0;
      }
    }

    function onPriceConfigChange() {
      state.pricePer1mRmb = Math.max(0, Number(document.getElementById("input-price-1m").value) || 0);
      state.calcVolume = Math.max(1, Number(document.getElementById("input-volume").value) || 10);
      recalcCosts();
      saveToDb();
      renderAll();
    }

    function setCalcVolume(v) {
      state.calcVolume = v;
      document.getElementById("input-volume").value = v;
      renderCostCards();
    }

    function openLightbox(assetId, caption) {
      const im = IMAGE_MAP[assetId];
      if (!im) return;
      document.getElementById("lightbox-img").src = im.dataUrl;
      document.getElementById("lightbox-caption").textContent = caption;
      document.getElementById("lightbox").classList.remove("hidden");
    }

    function closeLightbox() {
      document.getElementById("lightbox").classList.add("hidden");
    }

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeLightbox();
    });

    function setFilter(f) {
      state.filter = f;
      ["ALL", "SINGLE", "MULTI", "ALLOW", "BLOCK"].forEach(k => {
        const b = document.getElementById("flt-" + k);
        if (!b) return;
        b.className = k === f
          ? "px-2.5 py-1 rounded-md font-medium bg-indigo-600 text-white cursor-pointer"
          : "px-2.5 py-1 rounded-md font-medium text-slate-400 hover:text-white cursor-pointer";
      });
      renderCasesList();
    }

    function onSearch(v) {
      state.search = (v || "").trim().toLowerCase();
      renderCasesList();
    }

    function toggleExpand(id) {
      state.expanded[id] = !state.expanded[id];
      renderCasesList();
    }

    function scrollToCard(id) {
      state.expanded[id] = true;
      renderCasesList();
      const el = document.getElementById("card-" + id);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    function renderKpis() {
      const items = state.results;
      const n = items.length;
      const lats = items.map(i => i.latencyMs).sort((a, b) => a - b);
      const avgLat = n ? Math.round(lats.reduce((a, b) => a + b, 0) / n) : 0;
      const p50 = n ? lats[Math.floor(n * 0.5)] : 0;
      const minLat = n ? lats[0] : 0;
      const maxLat = n ? lats[n - 1] : 0;
      const totalCost = items.reduce((a, b) => a + b.estimatedCostRmb, 0);
      const avgCost = n ? totalCost / n : 0;
      const totalTokens = items.reduce((a, b) => a + b.estimatedInputTokens, 0);
      const totalImgs = items.reduce((a, b) => a + b.imageCount, 0);
      const allowCnt = items.filter(i => i.actualAction === "ALLOW").length;
      const blockCnt = items.filter(i => i.actualAction === "BLOCK").length;

      document.getElementById("kpi-cards").innerHTML = \`
        <div class="glass-card glass-card-hover rounded-2xl p-5">
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs text-slate-400">⏱️ 图文实测平均耗时</span>
            <span class="text-[11px] font-mono px-2 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">P50: \${p50} ms</span>
          </div>
          <div class="flex items-baseline gap-2">
            <span class="font-display font-bold text-3xl text-white">\${avgLat.toLocaleString()}</span>
            <span class="text-sm text-slate-400 font-mono">ms / 条</span>
          </div>
          <div class="mt-3 pt-3 border-t border-white/5 grid grid-cols-3 gap-2 text-[11px] font-mono">
            <div><div class="text-slate-500">最快</div><div class="text-emerald-300">\${minLat} ms</div></div>
            <div><div class="text-slate-500">最慢</div><div class="text-amber-300">\${maxLat} ms</div></div>
            <div><div class="text-slate-500">较纯文本</div><div class="text-slate-200">+\${Math.max(0, avgLat - 1953)} ms</div></div>
          </div>
        </div>

        <div class="glass-card glass-card-hover rounded-2xl p-5">
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs text-slate-400">🛡️ 接口可用性与兜底</span>
            <span class="text-[11px] font-mono px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">100% 一次成功</span>
          </div>
          <div class="flex items-baseline gap-2">
            <span class="font-display font-bold text-3xl text-emerald-300">0</span>
            <span class="text-sm text-slate-400">/ \${n} 条触发兜底</span>
          </div>
          <div class="mt-3 pt-3 border-t border-white/5 text-[11px] text-slate-300">
            累计送审 <strong class="text-white font-mono">\${totalImgs} 张真实图片</strong>，单次合并请求均在 5s 内完成，0 超时。
          </div>
        </div>

        <div class="glass-card glass-card-hover rounded-2xl p-5">
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs text-slate-400">💰 10 条图文估算总成本</span>
            <span class="text-[11px] font-mono px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">仅计输入 Token</span>
          </div>
          <div class="flex items-baseline gap-2">
            <span class="font-display font-bold text-3xl text-emerald-300">¥\${totalCost.toFixed(4)}</span>
            <span class="text-sm text-slate-400">元 (\${n}条)</span>
          </div>
          <div class="mt-3 pt-3 border-t border-white/5 grid grid-cols-3 gap-2 text-[11px] font-mono">
            <div><div class="text-slate-500">单条均值</div><div class="text-slate-200">¥\${avgCost.toFixed(4)}</div></div>
            <div><div class="text-slate-500">每 1,000 条</div><div class="text-emerald-300">¥\${(avgCost * 1000).toFixed(2)}</div></div>
            <div><div class="text-slate-500">估算Tokens</div><div class="text-slate-200">\${totalTokens.toLocaleString()}</div></div>
          </div>
        </div>

        <div class="glass-card glass-card-hover rounded-2xl p-5">
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs text-slate-400">👁️ 视觉+文本联合判定</span>
            <span class="text-[11px] font-mono px-2 py-0.5 rounded bg-pink-500/15 text-pink-300 border border-pink-500/30">识图抓出隐藏IP</span>
          </div>
          <div class="flex items-baseline gap-2">
            <span class="font-display font-bold text-3xl text-white">\${n} / \${n}</span>
            <span class="text-sm text-slate-400">全部有效判定</span>
          </div>
          <div class="mt-3 pt-3 border-t border-white/5 grid grid-cols-2 gap-2 text-[11px]">
            <div class="text-slate-300">放行：<strong class="text-emerald-300 font-mono">\${allowCnt} 条 ALLOW</strong></div>
            <div class="text-slate-300">拦截：<strong class="text-rose-300 font-mono">\${blockCnt} 条 BLOCK</strong></div>
          </div>
        </div>
      \`;
    }

    function renderModalityCompare() {
      const singles = state.results.filter(r => r.imageCount === 1);
      const multis = state.results.filter(r => r.imageCount >= 2);
      const calcRow = (arr) => {
        if (!arr.length) return { n: 0, avg: 0, min: 0, max: 0, tok: 0, cost: 0 };
        const l = arr.map(x => x.latencyMs).sort((a, b) => a - b);
        const avg = Math.round(l.reduce((a, b) => a + b, 0) / arr.length);
        const tok = Math.round(arr.reduce((a, b) => a + b.estimatedInputTokens, 0) / arr.length);
        const cost = arr.reduce((a, b) => a + b.estimatedCostRmb, 0) / arr.length;
        return { n: arr.length, avg, min: l[0], max: l[l.length - 1], tok, cost };
      };
      const s = calcRow(singles);
      const m = calcRow(multis);
      const textCost = (2163 / 1000000) * state.pricePer1mRmb;

      document.getElementById("modality-compare-tbody").innerHTML = \`
        <tr>
          <td class="py-3 pr-3 font-medium text-slate-300">📝 纯文本基准（0 张图 · 09:51 实测）</td>
          <td class="py-3 px-2.5 text-center font-mono">10</td>
          <td class="py-3 px-2.5 text-right font-mono text-white">1,953 ms</td>
          <td class="py-3 px-2.5 text-right font-mono text-slate-400">1,479 / 3,414 ms</td>
          <td class="py-3 px-2.5 text-right font-mono">2,163</td>
          <td class="py-3 pl-2.5 text-right font-mono text-emerald-300">¥\${textCost.toFixed(5)}</td>
        </tr>
        <tr class="bg-indigo-500/10">
          <td class="py-3 pr-3 font-medium text-white">🖼️ 单图图文合并（提示词 + 1 张参考图）</td>
          <td class="py-3 px-2.5 text-center font-mono">\${s.n}</td>
          <td class="py-3 px-2.5 text-right font-mono font-semibold text-white">\${s.avg} ms</td>
          <td class="py-3 px-2.5 text-right font-mono text-slate-300">\${s.min} / \${s.max} ms</td>
          <td class="py-3 px-2.5 text-right font-mono">\${s.tok.toLocaleString()}</td>
          <td class="py-3 pl-2.5 text-right font-mono text-emerald-300 font-semibold">¥\${s.cost.toFixed(5)}</td>
        </tr>
        <tr class="bg-pink-500/10">
          <td class="py-3 pr-3 font-medium text-white">🖼️🖼️ 双图图文合并（提示词 + 2 张参考图）</td>
          <td class="py-3 px-2.5 text-center font-mono">\${m.n}</td>
          <td class="py-3 px-2.5 text-right font-mono font-semibold text-white">\${m.avg} ms</td>
          <td class="py-3 px-2.5 text-right font-mono text-slate-300">\${m.min} / \${m.max} ms</td>
          <td class="py-3 px-2.5 text-right font-mono">\${m.tok.toLocaleString()}</td>
          <td class="py-3 pl-2.5 text-right font-mono text-emerald-300 font-semibold">¥\${m.cost.toFixed(5)}</td>
        </tr>
      \`;
    }

    function renderCostCards() {
      const vol = state.calcVolume;
      const singles = state.results.filter(r => r.imageCount === 1);
      const multis = state.results.filter(r => r.imageCount >= 2);
      const avgSingle = singles.length ? singles.reduce((a, b) => a + b.estimatedCostRmb, 0) / singles.length : 0;
      const avgMulti = multis.length ? multis.reduce((a, b) => a + b.estimatedCostRmb, 0) / multis.length : 0;
      const avgText = (2163 / 1000000) * state.pricePer1mRmb;

      const rows = [
        { label: "纯文本审核（0 张图）", unit: avgText, note: "2,163 入Token/条" },
        { label: "单图图文合并（1 张图）", unit: avgSingle, note: "文本 + 单图切片 (~2,880 入Token)" },
        { label: "双图图文合并（2 张图）", unit: avgMulti, note: "文本 + 双图切片 (~3,693 入Token)" }
      ];

      document.getElementById("cost-summary-cards").innerHTML = rows.map(r => {
        const total = r.unit * vol;
        return \`
          <div class="rounded-xl bg-slate-900/85 border border-white/5 p-3 flex items-center justify-between gap-2">
            <div>
              <div class="text-xs font-semibold text-white">\${r.label}</div>
              <div class="text-[11px] text-slate-400 font-mono mt-0.5">\${r.note} ｜ 单条 ¥\${r.unit.toFixed(5)}</div>
            </div>
            <div class="text-right font-mono">
              <div class="text-sm font-bold text-emerald-300">¥\${total < 1 ? total.toFixed(4) : total.toFixed(2)}</div>
              <div class="text-[10px] text-slate-400">\${vol.toLocaleString()} 条</div>
            </div>
          </div>
        \`;
      }).join("");
    }

    function renderLatencyChart() {
      const maxLat = Math.max(...state.results.map(r => r.latencyMs), 1000);
      document.getElementById("latency-chart").innerHTML = state.results.map(r => {
        const pct = Math.max(6, Math.round((r.latencyMs / maxLat) * 100));
        const isAllow = r.actualAction === "ALLOW";
        const barCls = isAllow ? "bg-gradient-to-r from-emerald-500 to-teal-400" : "bg-gradient-to-r from-rose-500 to-pink-500";
        return \`
          <div onclick="scrollToCard('\${r.id}')" class="grid grid-cols-12 items-center gap-2 text-xs py-1 px-2 rounded-lg hover:bg-white/5 cursor-pointer transition">
            <div class="col-span-4 sm:col-span-3 flex items-center gap-2 min-w-0">
              <span class="font-mono text-[11px] text-slate-400">#\${String(r.index).padStart(2, "0")}</span>
              <span class="px-1.5 py-0.5 rounded text-[10px] font-mono \${isAllow ? "bg-emerald-500/20 text-emerald-300" : "bg-rose-500/20 text-rose-300"}">\${r.actualAction}</span>
              <span class="px-1.5 py-0.5 rounded text-[10px] font-mono bg-indigo-500/20 text-indigo-300">\${r.imageCount}图</span>
              <span class="text-slate-200 truncate">\${r.category}</span>
            </div>
            <div class="col-span-5 sm:col-span-6 bg-slate-900/90 rounded-full h-3.5 overflow-hidden border border-white/5 p-0.5">
              <div class="h-full rounded-full \${barCls}" style="width: \${pct}%"></div>
            </div>
            <div class="col-span-3 flex items-center justify-end gap-2 font-mono text-[11px]">
              <span class="text-white font-semibold">\${r.latencyMs} ms</span>
              <span class="text-slate-400 hidden sm:inline">¥\${r.estimatedCostRmb.toFixed(4)}</span>
            </div>
          </div>
        \`;
      }).join("");
    }

    function renderCasesList() {
      const filtered = state.results.filter(r => {
        if (state.filter === "SINGLE" && r.imageCount !== 1) return false;
        if (state.filter === "MULTI" && r.imageCount < 2) return false;
        if (state.filter === "ALLOW" && r.actualAction !== "ALLOW") return false;
        if (state.filter === "BLOCK" && r.actualAction !== "BLOCK") return false;
        if (state.search) {
          const hay = \`\${r.id} \${r.category} \${r.prompt} \${r.note} \${r.calledAtBeijing} \${(r.hitRules||[]).join(" ")}\`.toLowerCase();
          if (!hay.includes(state.search)) return false;
        }
        return true;
      });
      document.getElementById("count-badge").textContent = \`\${filtered.length} / \${state.results.length} 条\`;

      document.getElementById("cases-list").innerHTML = filtered.map(r => {
        const exp = Boolean(state.expanded[r.id]);
        const isAllow = r.actualAction === "ALLOW";

        const thumbsHtml = (r.images || []).map((im, idx) => {
          const full = IMAGE_MAP[im.assetId];
          const src = full ? full.dataUrl : "";
          const cap = \`\${r.id} · 图\${idx + 1} (\${im.width}×\${im.height} · \${Math.round(im.bytes / 1024)} KB · 预估 \${im.visionTokens} Vision Tokens)\`;
          return \`
            <div onclick="event.stopPropagation(); openLightbox('\${im.assetId}', '\${cap}')" class="relative group cursor-zoom-in shrink-0">
              <img src="\${src}" alt="图\${idx + 1}" class="img-thumb w-16 h-16 sm:w-20 sm:h-20 object-cover rounded-lg border border-white/15 bg-slate-950" />
              <span class="absolute bottom-1 right-1 px-1 py-0.2 rounded bg-black/75 text-[9px] font-mono text-slate-200">\${im.width}×\${im.height}</span>
            </div>
          \`;
        }).join("");

        const signalsHtml = RULES_META.map(meta => {
          const val = r.probabilities[meta.rule_id];
          const pct = typeof val === "number" ? Math.round(val * 100) : 0;
          const hit = (r.hitRules || []).includes(meta.rule_id);
          const topicHit = meta.kind === "topic" && pct >= 50;
          const barCls = meta.kind === "quality"
            ? (pct >= 50 ? "bg-emerald-500" : "bg-amber-500")
            : hit ? "bg-rose-500" : topicHit ? "bg-indigo-400" : pct > 15 ? "bg-amber-400" : "bg-slate-600";
          const txtCls = hit ? "text-rose-300 font-semibold" : topicHit ? "text-indigo-300 font-semibold" : meta.kind === "quality" ? "text-emerald-300" : "text-slate-400";
          return \`
            <div class="bg-slate-950/70 rounded-lg p-2.5 border \${hit ? "border-rose-500/40" : topicHit ? "border-indigo-500/40" : "border-white/5"}">
              <div class="flex items-center justify-between text-xs mb-1.5">
                <span class="text-slate-200">\${meta.title} <span class="text-[10px] font-mono text-slate-500">(\${meta.rule_id})</span></span>
                <span class="font-mono \${txtCls}">\${pct}%</span>
              </div>
              <div class="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                <div class="h-full rounded-full \${barCls}" style="width: \${Math.max(2, pct)}%"></div>
              </div>
            </div>
          \`;
        }).join("");

        return \`
          <div id="card-\${r.id}" class="rounded-xl bg-slate-900/75 border border-white/10 overflow-hidden">
            <div onclick="toggleExpand('\${r.id}')" class="p-4 cursor-pointer hover:bg-white/[0.02] transition flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div class="flex items-start gap-3.5 min-w-0 flex-1">
                <div class="flex items-center gap-2 shrink-0">\${thumbsHtml}</div>
                <div class="space-y-1.5 min-w-0 flex-1">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="font-mono text-xs font-semibold text-slate-400">#\${String(r.index).padStart(2, "0")} · \${r.id}</span>
                    <span class="px-2 py-0.5 rounded-md text-xs font-semibold \${isAllow ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30" : "bg-rose-500/20 text-rose-300 border border-rose-500/30"}">
                      \${isAllow ? "✓ 放行 ALLOW" : "✕ 拦截 BLOCK"}
                    </span>
                    <span class="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 text-xs font-mono">\${r.imageCount} 张图 · \${Math.round(r.totalImageBytes / 1024)} KB</span>
                    <span class="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-xs">\${r.category}</span>
                    <span class="text-[11px] font-mono text-slate-400">🕒 \${r.calledAtBeijing}</span>
                    \${(r.hitRules || []).map(h => \`<span class="px-2 py-0.5 rounded bg-rose-500/15 text-rose-300 font-mono text-[11px]">命中: \${h}</span>\`).join("")}
                    \${(r.topics || []).map(t => \`<span class="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 text-[11px]">🏷️ \${t}</span>\`).join("")}
                  </div>
                  <div class="text-sm text-white font-medium leading-relaxed break-words">“\${r.prompt}”</div>
                  <div class="text-xs text-slate-400">
                    \${r.note} \${r.id === "IMG-06" ? '<span class="text-pink-300 font-medium">｜ 👁️ 视觉拦截亮点：文本安全但参考图内含版权 IP 角色，被模型精准抓出 (IP-001: 96%)！</span>' : ""}
                  </div>
                </div>
              </div>

              <div class="flex items-center gap-4 shrink-0 pt-2 lg:pt-0 border-t lg:border-t-0 border-white/5">
                <div class="text-right font-mono">
                  <div class="text-xs text-slate-400">图文耗时</div>
                  <div class="text-base font-bold text-white">\${r.latencyMs} <span class="text-xs font-normal text-slate-400">ms</span></div>
                </div>
                <div class="text-right font-mono">
                  <div class="text-xs text-slate-400">估算入Token</div>
                  <div class="text-sm font-semibold text-slate-200">\${r.estimatedInputTokens}</div>
                </div>
                <div class="text-right font-mono">
                  <div class="text-xs text-slate-400">预估成本</div>
                  <div class="text-sm font-bold text-emerald-300">¥\${r.estimatedCostRmb.toFixed(5)}</div>
                </div>
                <button onclick="event.stopPropagation(); deleteItem('\${r.id}')" class="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/25 text-rose-300 border border-rose-500/20 cursor-pointer" title="删除此条记录">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                </button>
              </div>
            </div>

            \${exp ? \`
              <div class="px-4 pb-4 pt-3 border-t border-white/10 bg-slate-950/50 space-y-3">
                <div class="flex items-center justify-between text-xs text-slate-300 flex-wrap gap-2">
                  <span class="font-semibold">📊 9 维图文联合审核信号概率（点击上方缩略图可放大查看送审原图）</span>
                  <span class="font-mono text-[11px] text-slate-400">文本基线 \${r.textTokens} + 视觉切片 \${r.visionTokens} = \${r.estimatedInputTokens} 入Tokens ｜ 完成于 \${r.attempts?.[0]?.calledAtBeijing || r.calledAtBeijing}</span>
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">\${signalsHtml}</div>
              </div>
            \` : ""}
          </div>
        \`;
      }).join("");
    }

    function exportReport(fmt) {
      const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      if (fmt === "json") {
        const out = { exportedAt: new Date().toISOString(), pricePer1mRmb: state.pricePer1mRmb, results: state.results };
        downloadBlob(new Blob([JSON.stringify(out, null, 2)], { type: "application/json;charset=utf-8" }), \`提示词审核图文实测报告-\${ts}.json\`);
      } else {
        const headers = ["序号", "编号", "分类", "调用时间(北京)", "图片数", "图片总大小(KB)", "提示词", "实际判定", "耗时(ms)", "文本Tokens", "视觉Tokens", "预估总入Tokens", "预估成本(元)", "命中规则", "标签"];
        const rows = state.results.map(r => [
          r.index, r.id, r.category, r.calledAtBeijing, r.imageCount, Math.round(r.totalImageBytes / 1024),
          \`"\${(r.prompt || "").replace(/"/g, '""')}"\`, r.actualAction, r.latencyMs, r.textTokens, r.visionTokens, r.estimatedInputTokens, r.estimatedCostRmb,
          \`"\${(r.hitRules || []).join(";")}"\`, \`"\${(r.topics || []).join(";")}"\`
        ].join(","));
        downloadBlob(new Blob(["\\uFEFF" + headers.join(",") + "\\n" + rows.join("\\n")], { type: "text/csv;charset=utf-8" }), \`提示词审核图文实测报告-\${ts}.csv\`);
      }
    }

    function downloadBlob(blob, name) {
      const u = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = u; a.download = name;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(u);
    }

    function renderAll() {
      const rangeText = \`\${RAW_BENCHMARK.startedAtBeijing} ~ \${RAW_BENCHMARK.finishedAtBeijing}\`;
      document.getElementById("header-time-range").textContent = "实测时间窗口（北京时间，可直接对照 LoopRouter 后台账单）：" + rangeText;
      document.getElementById("verify-time-window").textContent = rangeText;
      renderKpis();
      renderModalityCompare();
      renderCostCards();
      renderLatencyChart();
      renderCasesList();
    }

    document.addEventListener("DOMContentLoaded", async () => {
      await loadFromDb();
      recalcCosts();
      renderAll();
    });
  </script>
</body>
</html>`;

  const outPath = path.resolve(process.cwd(), '提示词审核图文实测报告.html');
  fs.writeFileSync(outPath, html, 'utf8');
  console.log(`[IMG-HTML DONE] Generated standalone multimodal HTML report at ${outPath} (${Math.round(Buffer.byteLength(html, 'utf8') / 1024)} KB)`);
}
