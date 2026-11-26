'use client';

import { useCallback, useEffect, useState } from 'react';
import { fileToImage, type RefImage } from '../images';
import { api, errorMessage, formatDate, ms, type Scene, type Tab, type Tone } from '../lib';
import { Alert, Badge, Card, EmptyState, Field, Icon, Spinner, Stat, Toggle, type ConfirmFn } from '../ui';

interface IntentActionDef {
  id: string;
  name: string;
  instructions: string;
  scene_id: string;
  dedicated_entries: string[];
  enabled: boolean;
}

interface IntentCategoryDef {
  name: string;
  description: string;
  enabled: boolean;
}

interface IntentFullConfig {
  enabled: boolean;
  confidence_threshold: number;
  text_channel: { primary_model_id: string; backup_model_id: string; timeout_ms: number };
  vision_channel: { primary_model_id: string; backup_model_id: string; timeout_ms: number; trigger_max_chars: number };
  actions: IntentActionDef[];
  categories: IntentCategoryDef[];
  clarify_notice: string;
  fallback_notice: string;
}

interface VersionRow {
  version: number;
  note: string;
  config: IntentFullConfig;
  created_by: string;
  created_at: string;
}

interface CandidateModel {
  id: string;
  name: string;
  vendor: string;
  protocol: string;
  model: string;
  key_env: string;
  key_configured: boolean;
  supports_vision: boolean;
  benchmark_note: string;
}

interface IntentRunRow {
  id: string;
  kind: string;
  channel_mode: string;
  model_id: string;
  failover_from: string | null;
  config_version: number;
  entry: string | null;
  image_count: number;
  input_preview: string;
  input_state: 'clear' | 'clarify' | 'fallback';
  action: string;
  category: string | null;
  routed_scene_id: string | null;
  wants_rendered_text: number;
  has_exclusions: number;
  confidence: number | null;
  latency_ms: number;
  status: 'ok' | 'degraded';
  error: string | null;
  created_at: string;
}

interface IntentAdminPayload {
  active_version: number;
  config: IntentFullConfig;
  versions: VersionRow[];
  candidate_models: CandidateModel[];
  scenes: Scene[];
  analytics: {
    total: number;
    clear_count: number;
    clarify_count: number;
    fallback_count: number;
    vision_count: number;
    failover_count: number;
    avg_ms: number | null;
    p50_ms: number | null;
    p95_ms: number | null;
    action_distribution: Array<{ action: string; count: number }>;
    category_distribution: Array<{ category: string; count: number }>;
    recent_runs: IntentRunRow[];
  };
}

interface TestIntentResponse {
  ok: boolean;
  intent: {
    status: 'ok' | 'failed';
    channel: string;
    model_id: string;
    failover_from: string | null;
    config_version: number;
    latency_ms: number;
    input_state: 'clear' | 'clarify' | 'fallback';
    action: string;
    action_label: string;
    routed_scene_id: string | null;
    entry_conflict: string | null;
    category: { value: string; probability: number } | null;
    wants_rendered_text: boolean;
    has_exclusions: boolean;
    confidence: number;
    error?: string;
  };
}

const channelLabels: Record<string, string> = {
  rule_fast: '本地规则秒判',
  text_fast: '纯文本极速通道',
  vision_ondemand: '按需看图通道',
  fallback_rule: '故障降级规则',
};

const stateBadges: Record<string, { label: string; tone: Tone }> = {
  clear: { label: '直接强化', tone: 'success' },
  clarify: { label: '常规分流', tone: 'info' },
  fallback: { label: '常规分流', tone: 'neutral' },
};

const sampleCases = [
  { label: '无缝平铺花型', text: '法式蓝白小雏菊无缝循环平铺印花图案，用于四件套面料设计', entry: '' },
  { label: '2字极简商品', text: '抱枕', entry: '' },
  { label: '纯数字艺术字', text: '111111111', entry: '' },
  { label: '真人模特展示', text: '年轻亚洲女模特身穿香槟色真丝睡衣坐在阳光卧室床边', entry: '' },
  { label: '专用页冲突检测', text: '纯白底亚麻抱枕静物特写，不要任何人物和模特', entry: 'model-gen' },
];

type SubTab = 'monitor' | 'channels' | 'rules' | 'versions';

export default function IntentConfigView({
  notify,
  confirm,
  go,
}: {
  notify: (msg: string, tone?: Tone) => void;
  confirm: ConfirmFn;
  go: (tab: Tab) => void;
}) {
  const [data, setData] = useState<IntentAdminPayload | null>(null);
  const [draft, setDraft] = useState<IntentFullConfig | null>(null);
  const [subTab, setSubTab] = useState<SubTab>('monitor');
  const [loadErr, setLoadErr] = useState('');
  const [busy, setBusy] = useState('');
  const [publishNote, setPublishNote] = useState('');
  const [probeMap, setProbeMap] = useState<Record<string, { ok: boolean; latency_ms: number; message: string }>>({});

  // 新增动作与品类临时状态
  const [newActId, setNewActId] = useState('');
  const [newActName, setNewActName] = useState('');
  const [newActScene, setNewActScene] = useState('home');
  const [newActInst, setNewActInst] = useState('');
  const [newCatName, setNewCatName] = useState('');
  const [newCatDesc, setNewCatDesc] = useState('');

  // 实时单测台状态
  const [testText, setTestText] = useState('法式蓝白小雏菊无缝循环平铺印花图案，用于四件套面料设计');
  const [testEntry, setTestEntry] = useState('');
  const [testImages, setTestImages] = useState<RefImage[]>([]);
  const [testResult, setTestResult] = useState<TestIntentResponse['intent'] | null>(null);
  const [testErr, setTestErr] = useState('');

  const load = useCallback(async (syncDraft = false) => {
    try {
      const d = await api<IntentAdminPayload>('/api/admin/intent');
      setData(d);
      if (syncDraft) setDraft(structuredClone(d.config));
      else setDraft((prev) => prev || structuredClone(d.config));
      setLoadErr('');
    } catch (e) {
      setLoadErr(errorMessage(e, '意图配置加载失败'));
    }
  }, []);

  useEffect(() => {
    void load(true);
  }, [load]);

  if (!data || !draft) {
    return (
      <div className="page">
        {loadErr ? <Alert tone="danger">{loadErr}</Alert> : <Card title="正在加载意图配置…"><Spinner /></Card>}
      </div>
    );
  }

  const isDirty = JSON.stringify(draft) !== JSON.stringify(data.config);
  const visionModels = data.candidate_models.filter((m) => m.supports_vision);

  async function publishChanges() {
    if (!draft) return;
    setBusy('publish');
    try {
      const res = await api<{ active_version: number }>('/api/admin/intent', {
        method: 'POST',
        body: JSON.stringify({ op: 'publish', config: draft, note: publishNote.trim() || '更新意图识别与分流配置' }),
      });
      setPublishNote('');
      await load(true);
      notify(`已发布并生效意图配置 V${res.active_version}`);
    } catch (e) {
      notify(errorMessage(e, '发布配置失败'), 'danger');
    } finally {
      setBusy('');
    }
  }

  async function rollbackTo(v: VersionRow) {
    const ok = await confirm({
      title: `回滚至版本 V${v.version}？`,
      confirmLabel: `确认回滚至 V${v.version}`,
      body: (
        <>
          <p>当前生效版本为 <strong>V{data?.active_version}</strong>，回滚后线上请求将立即改用 <strong>V{v.version}</strong>（{v.note}）的模型通道与路由规则。</p>
          <p>历史版本记录不会丢失，随时可再次切换。</p>
        </>
      ),
    });
    if (!ok) return;
    setBusy(`rollback-${v.version}`);
    try {
      await api('/api/admin/intent', { method: 'POST', body: JSON.stringify({ op: 'rollback', target_version: v.version }) });
      await load(true);
      notify(`已一键回滚至版本 V${v.version}`);
    } catch (e) {
      notify(errorMessage(e, '回滚失败'), 'danger');
    } finally {
      setBusy('');
    }
  }

  async function probeModel(id: string) {
    setBusy(`probe-${id}`);
    try {
      const res = await api<{ ok: boolean; latency_ms: number; message: string }>('/api/admin/intent', {
        method: 'POST',
        body: JSON.stringify({ op: 'probe_model', model_id: id }),
      });
      setProbeMap((old) => ({ ...old, [id]: res }));
      notify(res.message, res.ok ? 'success' : 'danger');
    } catch (e) {
      notify(errorMessage(e, '测速失败'), 'danger');
    } finally {
      setBusy('');
    }
  }

  async function runSingleTest() {
    setBusy('test');
    setTestErr('');
    try {
      const context: Record<string, unknown> = {};
      if (testEntry) context.entry = testEntry;
      if (testImages.length) context.reference_images = testImages.map((img) => img.src);
      const res = await api<TestIntentResponse>('/api/admin/intent', {
        method: 'POST',
        body: JSON.stringify({ op: 'test_input', text: testText, context }),
      });
      setTestResult(res.intent);
      void load(false);
    } catch (e) {
      setTestErr(errorMessage(e, '试跑失败'));
    } finally {
      setBusy('');
    }
  }

  async function onUploadTestFiles(files: FileList | null) {
    if (!files?.length) return;
    try {
      const added = await Promise.all([...files].slice(0, 3 - testImages.length).map(fileToImage));
      setTestImages((old) => [...old, ...added].slice(0, 3));
    } catch (e) {
      setTestErr(errorMessage(e, '读取图片失败'));
    }
  }

  function addAction() {
    const id = newActId.trim().toLowerCase();
    const name = newActName.trim();
    const inst = newActInst.trim();
    if (!/^[a-z0-9_]{2,32}$/.test(id) || id === 'none') {
      notify('动作标识需为 2～32 位小写英文/数字/下划线', 'danger');
      return;
    }
    if (draft!.actions.some((a) => a.id === id)) {
      notify('该动作标识已存在', 'danger');
      return;
    }
    if (!name || !inst) {
      notify('请填写动作名称与判定说明', 'danger');
      return;
    }
    setDraft({
      ...draft!,
      actions: [
        ...draft!.actions,
        { id, name, instructions: inst, scene_id: newActScene, dedicated_entries: [], enabled: true },
      ],
    });
    setNewActId('');
    setNewActName('');
    setNewActInst('');
  }

  function addCategory() {
    const name = newCatName.trim();
    if (!name) return;
    if (draft!.categories.some((c) => c.name === name)) {
      notify('该品类名称已存在', 'danger');
      return;
    }
    setDraft({
      ...draft!,
      categories: [...draft!.categories, { name, description: newCatDesc.trim() || name, enabled: true }],
    });
    setNewCatName('');
    setNewCatDesc('');
  }

  const { analytics } = data;

  return (
    <div className="page stack">
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div className="chips" role="tablist" aria-label="意图识别子导航">
          <button type="button" className={subTab === 'monitor' ? 'chip active' : 'chip'} onClick={() => setSubTab('monitor')}>
            实时试跑与监控看板
          </button>
          <button type="button" className={subTab === 'channels' ? 'chip active' : 'chip'} onClick={() => setSubTab('channels')}>
            双通道模型池与容灾
          </button>
          <button type="button" className={subTab === 'rules' ? 'chip active' : 'chip'} onClick={() => setSubTab('rules')}>
            动作路由与品类规则 {isDirty && '●'}
          </button>
          <button type="button" className={subTab === 'versions' ? 'chip active' : 'chip'} onClick={() => setSubTab('versions')}>
            版本历史与回滚（当前 V{data.active_version}）
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Badge tone={data.config.enabled ? 'success' : 'neutral'}>
            {data.config.enabled ? `生效中 · V${data.active_version}` : '已关闭（走本地规则）'}
          </Badge>
          {isDirty && <Badge tone="warning">有未发布修改</Badge>}
        </div>
      </div>

      {/* 子面板 1：监控与实时试跑调试台 */}
      {subTab === 'monitor' && (
        <div className="stack">
          <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <Stat label="累计意图识别" value={analytics.total.toLocaleString('zh-CN')} detail={`按需看图 ${analytics.vision_count} 次 · 切备 ${analytics.failover_count} 次`} />
            <Stat label="模型通道中位延迟 (P50)" value={ms(analytics.p50_ms)} detail={`均值 ${ms(analytics.avg_ms)} · P95 ${ms(analytics.p95_ms)}`} />
            <Stat label="全量放行分流" value={analytics.clear_count.toLocaleString('zh-CN')} detail="无拦截 · 自动匹配对应创作动作模板" />
          </div>

          <div className="split">
            <div className="split-main stack">
              <Card title="意图识别实时单测台" description="独立测试创作动作归类、按需看图触发与强化模板分流结果（零拦截，不消耗下游强化生成算力）">
                <div className="chips">
                  {sampleCases.map((s) => (
                    <button
                      key={s.label}
                      type="button"
                      className={testText === s.text && testEntry === s.entry ? 'chip active' : 'chip'}
                      onClick={() => {
                        setTestText(s.text);
                        setTestEntry(s.entry);
                      }}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
                <Field label="模拟用户输入文本" htmlFor="intent-test-text" hint="留空并上传参考图可验证「按需看图」多模态通道">
                  <textarea id="intent-test-text" rows={3} value={testText} onChange={(e) => setTestText(e.target.value)} placeholder="输入生图/改图描述，或留空仅上传参考图…" />
                </Field>
                <div className="form-row two">
                  <Field label="模拟页面入口（context.entry）" htmlFor="intent-test-entry" hint="综合入口按意图自动分流；专用入口检测冲突">
                    <select id="intent-test-entry" value={testEntry} onChange={(e) => setTestEntry(e.target.value)}>
                      <option value="">未指定（综合入口自动分流）</option>
                      {data.scenes.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}（{s.id}）
                        </option>
                      ))}
                    </select>
                  </Field>
                  <div className="field">
                    <div className="field-label">
                      <span className="label">模拟参考图（{testImages.length} / 3）</span>
                    </div>
                    <div className="ref-grid">
                      {testImages.map((img, i) => (
                        <figure className="ref-thumb" key={`${i}-${img.label}`}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={img.src} alt={`参考图 ${i + 1}`} />
                          <button type="button" className="ref-remove" onClick={() => setTestImages((old) => old.filter((_, idx) => idx !== i))} aria-label="移除">
                            <Icon name="close" size={14} />
                          </button>
                        </figure>
                      ))}
                      {testImages.length < 3 && (
                        <label className="ref-add">
                          <input
                            type="file"
                            className="sr-only"
                            accept="image/png,image/jpeg,image/webp,image/gif"
                            multiple
                            onChange={(e) => {
                              void onUploadTestFiles(e.target.files);
                              e.target.value = '';
                            }}
                          />
                          <Icon name="plus" size={16} />
                          <span>传参考图</span>
                        </label>
                      )}
                    </div>
                  </div>
                </div>
                {testErr && <Alert tone="danger">{testErr}</Alert>}
                <div className="actions">
                  <button type="button" className="btn btn-primary" onClick={() => void runSingleTest()} disabled={busy !== ''}>
                    {busy === 'test' ? <Spinner /> : <Icon name="play" size={15} />}
                    试跑意图拆解
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => go('playground')}>
                    前往完整提示词强化测试台 →
                  </button>
                </div>
              </Card>
            </div>

            <div className="split-side">
              <Card title="拆解与路由判定结果" className="sticky">
                {!testResult ? (
                  <EmptyState title="等待试跑">点击左侧「试跑意图拆解」，实时查看耗时、三层标签与匹配的强化场景模板。</EmptyState>
                ) : (
                  <div className="stack" style={{ gap: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                      <Badge tone={stateBadges[testResult.input_state]?.tone || 'info'}>{stateBadges[testResult.input_state]?.label || testResult.input_state}</Badge>
                      <span className="num" style={{ fontWeight: 700 }}>{testResult.latency_ms} ms</span>
                    </div>
                    {testResult.entry_conflict && <Alert tone="warning">{testResult.entry_conflict}</Alert>}
                    <dl className="facts">
                      <div>
                        <dt>执行通道</dt>
                        <dd>{channelLabels[testResult.channel] || testResult.channel}</dd>
                      </div>
                      <div>
                        <dt>实际模型</dt>
                        <dd>
                          <code>{testResult.model_id}</code>
                          {testResult.failover_from ? `（自 ${testResult.failover_from} 切备）` : ''}
                        </dd>
                      </div>
                      <div>
                        <dt>创作动作意图</dt>
                        <dd>
                          <strong>{testResult.action_label}</strong>（<code>{testResult.action}</code>）
                        </dd>
                      </div>
                      <div>
                        <dt>路由目标模板</dt>
                        <dd>
                          {testResult.routed_scene_id ? (
                            <Badge tone="info" icon={false}>
                              {data.scenes.find((s) => s.id === testResult.routed_scene_id)?.name || testResult.routed_scene_id}（{testResult.routed_scene_id}）
                            </Badge>
                          ) : (
                            '通用强化（默认）'
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>识别主题品类</dt>
                        <dd>{testResult.category ? `${testResult.category.value}（${Math.round(testResult.category.probability * 100)}%）` : '—'}</dd>
                      </div>
                      <div>
                        <dt>约束特征</dt>
                        <dd>
                          画面文字：{testResult.wants_rendered_text ? '需要渲染' : '否'} · 负向排除：{testResult.has_exclusions ? '有' : '无'}
                        </dd>
                      </div>
                    </dl>
                  </div>
                )}
              </Card>
            </div>
          </div>

          <div className="form-row two">
            <Card title="各创作动作命中分布" flush>
              {analytics.action_distribution.length ? (
                <table className="table">
                  <thead>
                    <tr>
                      <th>动作标识 / 名称</th>
                      <th className="r">命中次数</th>
                      <th className="r">占比</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.action_distribution.map((item) => {
                      const actName = data.config.actions.find((a) => a.id === item.action)?.name || (item.action === 'none' ? '空输入' : item.action);
                      return (
                        <tr key={item.action}>
                          <td>
                            <strong>{actName}</strong> <code className="cell-sub">{item.action}</code>
                          </td>
                          <td className="r num">{item.count}</td>
                          <td className="r num">{analytics.total ? `${Math.round((item.count / analytics.total) * 100)}%` : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <EmptyState title="暂无调用统计" />
              )}
            </Card>

            <Card title="热门主题品类分布" flush>
              {analytics.category_distribution.length ? (
                <table className="table">
                  <thead>
                    <tr>
                      <th>商品 / 画面品类</th>
                      <th className="r">识别次数</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.category_distribution.map((item) => (
                      <tr key={item.category}>
                        <td>{item.category}</td>
                        <td className="r num">{item.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <EmptyState title="暂无品类统计" />
              )}
            </Card>
          </div>

          <Card title="最近意图识别调用明细" description="展示最近 50 条线上与试跑请求的实时拆解表现" flush>
            {analytics.recent_runs.length ? (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>时间 / 来源</th>
                      <th>输入摘要</th>
                      <th>通道 / 模型</th>
                      <th>判定状态 & 动作</th>
                      <th>品类 & 路由场景</th>
                      <th className="r">耗时</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.recent_runs.map((r) => (
                      <tr key={r.id}>
                        <td className="nowrap">
                          <span className="cell-main">{formatDate(r.created_at)}</span>
                          <span className="cell-sub">{r.kind === 'live' ? '线上请求' : r.kind === 'test' ? '单测调试' : '测试台'} · V{r.config_version}</span>
                        </td>
                        <td style={{ maxWidth: 280 }}>
                          <span className="cell-main">{r.input_preview}</span>
                          <span className="cell-sub">
                            传图 {r.image_count} 张{r.entry ? ` · 入口 ${r.entry}` : ''}
                          </span>
                        </td>
                        <td>
                          <span className="cell-main">{channelLabels[r.channel_mode] || r.channel_mode}</span>
                          <code className="cell-sub">{r.model_id}{r.failover_from ? ` (备←${r.failover_from})` : ''}</code>
                        </td>
                        <td>
                          <Badge tone={stateBadges[r.input_state]?.tone || 'neutral'}>{stateBadges[r.input_state]?.label || r.input_state}</Badge>
                          <span className="cell-sub">{data.config.actions.find((a) => a.id === r.action)?.name || r.action}</span>
                        </td>
                        <td>
                          <span className="cell-main">{r.category || '—'}</span>
                          <span className="cell-sub">{r.routed_scene_id ? `→ ${r.routed_scene_id}` : '→ 默认强化'}</span>
                        </td>
                        <td className="r num nowrap">{r.latency_ms} ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title="暂无调用明细" />
            )}
          </Card>
        </div>
      )}

      {/* 子面板 2：双通道模型池与超时容灾配置 */}
      {subTab === 'channels' && (
        <div className="stack">
          <Card
            title="全局开关与置信度"
            description="关闭总开关时，系统自动退回 0ms 本地启发式规则，不发起外部意图模型请求"
            actions={
              <label className="toggle-label" htmlFor="intent-master-enabled">
                <span>{draft.enabled ? '已启用意图模型路由' : '已停用（仅本地规则）'}</span>
                <Toggle id="intent-master-enabled" checked={draft.enabled} onChange={(v) => setDraft({ ...draft, enabled: v })} label="启用意图识别" />
              </label>
            }
          >
            <div className="form-row two">
              <Field label="布尔特征判定置信度阈值" htmlFor="intent-conf" hint="默认 0.50；用于控制画面文字与负向排除特征的触发灵敏度">
                <input
                  id="intent-conf"
                  type="number"
                  step={0.05}
                  min={0.1}
                  max={0.95}
                  className="num narrow"
                  value={draft.confidence_threshold}
                  onChange={(e) => setDraft({ ...draft, confidence_threshold: Number(e.target.value) })}
                />
              </Field>
            </div>
          </Card>

          <div className="form-row two">
            <Card title="通道一：常态纯文本极速通道" description="90% 常规请求走此通道（不上传原图字节，死守极低延迟，仅做动作路由不做拦截）">
              <Field label="首选主模型" htmlFor="intent-tc-pri" hint="推荐豆包 Seed 2.1 Lite（70样本准确率100%，P50 432ms）">
                <select
                  id="intent-tc-pri"
                  value={draft.text_channel.primary_model_id}
                  onChange={(e) => setDraft({ ...draft, text_channel: { ...draft.text_channel, primary_model_id: e.target.value } })}
                >
                  {data.candidate_models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}{!m.key_configured ? '（未配密钥）' : ''}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="异构容灾备用模型" htmlFor="intent-tc-bak" hint="主模型超时或波动时立即无缝切换；推荐通义 Qwen 3.8 Flash（官方直连异构互备）">
                <select
                  id="intent-tc-bak"
                  value={draft.text_channel.backup_model_id}
                  onChange={(e) => setDraft({ ...draft, text_channel: { ...draft.text_channel, backup_model_id: e.target.value } })}
                >
                  <option value="">不使用备用模型（直接退回本地规则）</option>
                  {data.candidate_models
                    .filter((m) => m.id !== draft.text_channel.primary_model_id)
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}{!m.key_configured ? '（未配密钥）' : ''}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="单次超时上限（ms）" htmlFor="intent-tc-to" hint="超过该毫秒数立即切备用模型，绝不拖慢生图主链路">
                <input
                  id="intent-tc-to"
                  type="number"
                  step={100}
                  min={300}
                  max={10000}
                  className="num narrow"
                  value={draft.text_channel.timeout_ms}
                  onChange={(e) => setDraft({ ...draft, text_channel: { ...draft.text_channel, timeout_ms: Number(e.target.value) } })}
                />
              </Field>
            </Card>

            <Card title="通道二：按需看图多模态通道" description="仅当用户上传了参考图、但未写文字或只写“同款/优化”等泛指短词时自动触发">
              <Field label="看图首选主模型" htmlFor="intent-vc-pri" hint="仅列出支持多模态看图的模型；推荐豆包 Seed 2.1 Lite（看图均耗 766ms 全场最快）">
                <select
                  id="intent-vc-pri"
                  value={draft.vision_channel.primary_model_id}
                  onChange={(e) => setDraft({ ...draft, vision_channel: { ...draft.vision_channel, primary_model_id: e.target.value } })}
                >
                  {visionModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}{!m.key_configured ? '（未配密钥）' : ''}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="看图异构备用模型" htmlFor="intent-vc-bak">
                <select
                  id="intent-vc-bak"
                  value={draft.vision_channel.backup_model_id}
                  onChange={(e) => setDraft({ ...draft, vision_channel: { ...draft.vision_channel, backup_model_id: e.target.value } })}
                >
                  <option value="">不使用备用模型</option>
                  {visionModels
                    .filter((m) => m.id !== draft.vision_channel.primary_model_id)
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}{!m.key_configured ? '（未配密钥）' : ''}
                      </option>
                    ))}
                </select>
              </Field>
              <div className="form-row two">
                <Field label="看图超时上限（ms）" htmlFor="intent-vc-to">
                  <input
                    id="intent-vc-to"
                    type="number"
                    step={200}
                    min={500}
                    max={15000}
                    className="num narrow"
                    value={draft.vision_channel.timeout_ms}
                    onChange={(e) => setDraft({ ...draft, vision_channel: { ...draft.vision_channel, timeout_ms: Number(e.target.value) } })}
                  />
                </Field>
                <Field label="触发看图的最大字数" htmlFor="intent-vc-chars" hint="有图且文字字数 ≤ 此值（不含明确去水印词）时看图">
                  <input
                    id="intent-vc-chars"
                    type="number"
                    min={0}
                    max={30}
                    className="num narrow"
                    value={draft.vision_channel.trigger_max_chars}
                    onChange={(e) => setDraft({ ...draft, vision_channel: { ...draft.vision_channel, trigger_max_chars: Number(e.target.value) } })}
                  />
                </Field>
              </div>
            </Card>
          </div>

          <Card title="独立意图候选模型池与连通测速" description="完全独立于内容审核模型池；可随时点击「测速」检验当前网络下的真实响应耗时" flush>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>候选模型</th>
                    <th>渠道协议</th>
                    <th>多模态看图</th>
                    <th>密钥状态</th>
                    <th>选型实测基准</th>
                    <th>实时探测结果</th>
                    <th className="r">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {data.candidate_models.map((m) => {
                    const p = probeMap[m.id];
                    return (
                      <tr key={m.id}>
                        <td>
                          <strong>{m.name}</strong>
                          <code className="cell-sub">{m.model}</code>
                        </td>
                        <td>{m.vendor}</td>
                        <td>{m.supports_vision ? <Badge tone="success">支持看图</Badge> : <Badge>仅纯文本</Badge>}</td>
                        <td>
                          {m.key_configured ? <Badge tone="success">已就绪</Badge> : <Badge tone="danger">缺密钥</Badge>}
                          <code className="cell-sub">{m.key_env}</code>
                        </td>
                        <td><span className="cell-sub">{m.benchmark_note}</span></td>
                        <td>
                          {p ? (
                            <Badge tone={p.ok ? 'success' : 'danger'}>{p.message}</Badge>
                          ) : (
                            <span className="muted-inline">未探测</span>
                          )}
                        </td>
                        <td className="r">
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void probeModel(m.id)} disabled={busy !== ''}>
                            {busy === `probe-${m.id}` && <Spinner />}测速
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* 子面板 3：创作动作路由与主题品类词表编辑器 */}
      {subTab === 'rules' && (
        <div className="stack">
          <Card title="创作动作分类与强化模板路由表" description="定义识别出每种创作动作后自动匹配哪套专属强化模板">
            <div className="stack">
              {draft.actions.map((act, idx) => (
                <div key={act.id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <strong>{act.name}</strong>
                      <code>{act.id}</code>
                      {!act.enabled && <Badge>已停用</Badge>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Toggle
                        checked={act.enabled}
                        onChange={(v) => {
                          const next = [...draft.actions];
                          next[idx] = { ...act, enabled: v };
                          setDraft({ ...draft, actions: next });
                        }}
                        label={`启用 ${act.name}`}
                      />
                      {draft.actions.length > 1 && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => setDraft({ ...draft, actions: draft.actions.filter((_, i) => i !== idx) })}
                        >
                          删除
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="form-row two">
                    <Field label="动作名称" htmlFor={`act-name-${act.id}`}>
                      <input
                        id={`act-name-${act.id}`}
                        value={act.name}
                        maxLength={30}
                        onChange={(e) => {
                          const next = [...draft.actions];
                          next[idx] = { ...act, name: e.target.value };
                          setDraft({ ...draft, actions: next });
                        }}
                      />
                    </Field>
                    <Field label="路由绑定的强化模板" htmlFor={`act-scene-${act.id}`} hint="识别出该动作后自动套用对应的专属扩写规则">
                      <select
                        id={`act-scene-${act.id}`}
                        value={act.scene_id}
                        onChange={(e) => {
                          const next = [...draft.actions];
                          next[idx] = { ...act, scene_id: e.target.value };
                          setDraft({ ...draft, actions: next });
                        }}
                      >
                        {data.scenes.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}（{s.id}）
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <Field label="给意图模型的判定口径说明" htmlFor={`act-inst-${act.id}`}>
                    <textarea
                      id={`act-inst-${act.id}`}
                      rows={2}
                      maxLength={400}
                      value={act.instructions}
                      onChange={(e) => {
                        const next = [...draft.actions];
                        next[idx] = { ...act, instructions: e.target.value };
                        setDraft({ ...draft, actions: next });
                      }}
                    />
                  </Field>
                </div>
              ))}

              <div className="inline-form" style={{ border: '1px dashed var(--border)', borderRadius: 10, padding: 14 }}>
                <strong style={{ display: 'block', marginBottom: 8 }}>+ 新增创作动作分支</strong>
                <div className="form-row">
                  <Field label="动作英文标识" htmlFor="new-act-id" hint="如 poster_layout">
                    <input id="new-act-id" value={newActId} onChange={(e) => setNewActId(e.target.value)} placeholder="poster_layout" />
                  </Field>
                  <Field label="动作中文名" htmlFor="new-act-name">
                    <input id="new-act-name" value={newActName} onChange={(e) => setNewActName(e.target.value)} placeholder="营销海报排版" />
                  </Field>
                  <Field label="绑定强化场景" htmlFor="new-act-scene">
                    <select id="new-act-scene" value={newActScene} onChange={(e) => setNewActScene(e.target.value)}>
                      {data.scenes.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}（{s.id}）
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <Field label="判定口径说明" htmlFor="new-act-inst">
                  <input id="new-act-inst" value={newActInst} onChange={(e) => setNewActInst(e.target.value)} placeholder="描述什么样的用户输入应归入此动作…" />
                </Field>
                <div className="actions">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={addAction}>
                    添加至草稿列表
                  </button>
                </div>
              </div>
            </div>
          </Card>

          <Card title="主题品类词表（家纺核心细分 + 其他归拢）" description="支持随时增删品类或微调边界说明">
            <div className="table-wrap">
              <table className="table table-form">
                <thead>
                  <tr>
                    <th style={{ width: 180 }}>品类名称</th>
                    <th>包含范围与归拢说明</th>
                    <th style={{ width: 80 }}>启用</th>
                    <th className="r" style={{ width: 80 }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {draft.categories.map((cat, idx) => (
                    <tr key={cat.name}>
                      <td><strong>{cat.name}</strong></td>
                      <td>
                        <input
                          value={cat.description}
                          maxLength={200}
                          onChange={(e) => {
                            const next = [...draft.categories];
                            next[idx] = { ...cat, description: e.target.value };
                            setDraft({ ...draft, categories: next });
                          }}
                        />
                      </td>
                      <td>
                        <Toggle
                          checked={cat.enabled}
                          onChange={(v) => {
                            const next = [...draft.categories];
                            next[idx] = { ...cat, enabled: v };
                            setDraft({ ...draft, categories: next });
                          }}
                          label={`启用 ${cat.name}`}
                        />
                      </td>
                      <td className="r">
                        {draft.categories.length > 1 && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => setDraft({ ...draft, categories: draft.categories.filter((_, i) => i !== idx) })}
                          >
                            移除
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="form-row" style={{ marginTop: 12, alignItems: 'flex-end' }}>
              <Field label="新增品类名称" htmlFor="new-cat-name">
                <input id="new-cat-name" value={newCatName} onChange={(e) => setNewCatName(e.target.value)} placeholder="如：凉席蚊帐" maxLength={24} />
              </Field>
              <Field label="范围说明" htmlFor="new-cat-desc">
                <input id="new-cat-desc" value={newCatDesc} onChange={(e) => setNewCatDesc(e.target.value)} placeholder="含冰丝席、竹席、蒙古包蚊帐等" maxLength={200} />
              </Field>
              <button type="button" className="btn btn-secondary" onClick={addCategory} disabled={!newCatName.trim()}>
                新增品类
              </button>
            </div>
          </Card>
        </div>
      )}

      {/* 子面板 4：版本历史与一键回滚 */}
      {subTab === 'versions' && (
        <Card title="意图配置版本历史与一键回滚" description="每次发布自动生成完整配置快照；线上发现分类偏差可秒级回滚至任意历史版本" flush>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>版本号</th>
                  <th>版本变更说明</th>
                  <th>纯文本主 / 备模型</th>
                  <th>动作数 / 品类数</th>
                  <th>发布时间</th>
                  <th className="r">操作</th>
                </tr>
              </thead>
              <tbody>
                {data.versions.map((v) => {
                  const active = v.version === data.active_version;
                  return (
                    <tr key={v.version}>
                      <td className="nowrap">
                        <strong>V{v.version}</strong> {active && <Badge tone="success">当前生效</Badge>}
                      </td>
                      <td>{v.note}</td>
                      <td>
                        <code>{v.config.text_channel.primary_model_id}</code>
                        {v.config.text_channel.backup_model_id ? ` / 备 ${v.config.text_channel.backup_model_id}` : ''}
                      </td>
                      <td className="num">
                        {v.config.actions.filter((a) => a.enabled).length} 动作 · {v.config.categories.filter((c) => c.enabled).length} 品类
                      </td>
                      <td className="nowrap">{formatDate(v.created_at)}</td>
                      <td className="r nowrap">
                        {active ? (
                          <span className="muted-inline">正在使用</span>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => void rollbackTo(v)}
                            disabled={busy !== ''}
                          >
                            {busy === `rollback-${v.version}` && <Spinner />}一键回滚至此版
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* 底部全局保存发布浮动条（当通道或规则有修改时显示） */}
      {(subTab === 'channels' || subTab === 'rules' || isDirty) && (
        <div className="actions sticky-actions" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
          <input
            style={{ maxWidth: 320 }}
            value={publishNote}
            onChange={(e) => setPublishNote(e.target.value)}
            placeholder="填写本次配置变更备注（选填，便于回滚识别）…"
            maxLength={100}
          />
          <button type="button" className="btn btn-primary" onClick={() => void publishChanges()} disabled={busy !== '' || !isDirty}>
            {busy === 'publish' && <Spinner />}发布新版本并生效
          </button>
          {isDirty ? (
            <button type="button" className="btn btn-ghost" onClick={() => setDraft(structuredClone(data.config))} disabled={busy !== ''}>
              放弃未发布修改
            </button>
          ) : (
            <span className="actions-note">当前配置与线上生效版本 V{data.active_version} 一致</span>
          )}
        </div>
      )}
    </div>
  );
}
