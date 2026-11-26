'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage, formatTime, TABS, type ConsoleData, type Tab, type Tone } from './lib';
import { Alert, Icon, Spinner, useConfirm } from './ui';
import Overview from './views/Overview';
import Playground from './views/Playground';
import IntentConfigView from './views/IntentConfig';
import PromptsView from './views/Prompts';
import ModelsView from './views/Models';
import ScenesView from './views/Scenes';
import SettingsView from './views/Settings';
import RunsView from './views/Runs';
import AuditView from './views/Audit';
import ReviewWorkbench from './review/Workbench';
import ReviewRecords from './review/Records';
import ReviewRules from './review/Rules';
import type { ReviewHealth } from './review/shared';
import { Badge } from './ui';

const pages: Record<Tab,{title:string;description:string;icon:Parameters<typeof Icon>[0]['name']}> = {
  overview:{title:'首页看板',description:'每次审核耗时走势、区间分布、命中规则统计与实时明细',icon:'overview'},
  runs:{title:'调用记录',description:'每次强化请求的结果、耗时与模型切换',icon:'runs'},
  playground:{title:'测试台',description:'用真实模型试跑输入，对比不同模型与提示词版本效果',icon:'playground'},
  intent:{title:'意图配置',description:'双通道意图模型选型、三层分流路由规则、版本回滚与实时监控',icon:'rules'},
  prompts:{title:'系统提示词',description:'编辑、评测与发布提示词版本',icon:'prompts'},
  models:{title:'模型与渠道',description:'启停模型，调整超时与输出上限',icon:'models'},
  scenes:{title:'使用场景',description:'按创作场景或网站入口配置专属强化规则',icon:'scenes'},
  settings:{title:'运行设置',description:'默认强化模型、备用容灾模型与参考图视觉描述模型',icon:'settings'},
  audit:{title:'变更审计',description:'配置、提示词与场景的修改记录',icon:'audit'},
  review:{title:'审核工作台',description:'提交提示词与参考图，查看判定结果与原因',icon:'shield'},
  'review-records':{title:'审核记录',description:'全部审核任务的处置、模式与规则版本',icon:'runs'},
  'review-rules':{title:'审核规则',description:'规则说明、拦截阈值与版本',icon:'rules'},
};

const groups: Array<{label:string;tabs:Tab[]}> = [
  {label:'内容审核',tabs:['overview','review','review-records','review-rules']},
  {label:'提示词强化 · 监控',tabs:['runs']},
  {label:'调优',tabs:['playground','intent','prompts']},
  {label:'配置',tabs:['models','scenes','settings']},
  {label:'审计',tabs:['audit']},
];

function tabFromHash(): Tab {
  const hash = typeof window === 'undefined' ? '' : window.location.hash.slice(1);
  return (TABS as string[]).includes(hash) ? hash as Tab : 'overview';
}

export default function Console() {
  const [tab,setTab] = useState<Tab>('overview');
  const [data,setData] = useState<ConsoleData|null>(null);
  const [loadError,setLoadError] = useState('');
  const [toast,setToast] = useState<{message:string;tone:Tone}|null>(null);
  const [navOpen,setNavOpen] = useState(false);
  const [confirmDialog,confirm] = useConfirm();
  const [reviewHealth,setReviewHealth] = useState<ReviewHealth|null>(null);
  const refreshReviewHealth = useCallback(async()=>{ try { setReviewHealth(await api<ReviewHealth>('/api/review/health')); } catch { /* shown on the review pages */ } },[]);

  const refresh = useCallback(async()=>{
    try {
      const [config,prompts,runs,audit,scenes,overview] = await Promise.all([
        api<ConsoleData['config']>('/api/admin/config'),api<ConsoleData['prompts']>('/api/admin/prompt-versions'),
        api<ConsoleData['runs']>('/api/admin/runs'),api<ConsoleData['audit']>('/api/admin/audit'),
        api<{scenes:ConsoleData['scenes']}>('/api/admin/scenes'),api<ConsoleData['overview']>('/api/admin/overview'),
      ]);
      setData({config,prompts,runs,audit,scenes:scenes.scenes,overview});
      setLoadError('');
    } catch(cause) { setLoadError(errorMessage(cause,'数据加载失败')); }
  },[]);

  useEffect(()=>{
    setTab(tabFromHash());
    const onHash = () => {
      setTab(tabFromHash());
      setNavOpen(false);
      void refresh();
      void refreshReviewHealth();
    };
    const onFocus = () => {
      if (document.visibilityState === 'visible') {
        void refresh();
        void refreshReviewHealth();
      }
    };
    window.addEventListener('hashchange',onHash);
    window.addEventListener('focus',onFocus);
    document.addEventListener('visibilitychange',onFocus);
    void refresh(); void refreshReviewHealth();
    const timer = setInterval(()=>{
      if (document.visibilityState === 'visible') {
        void refresh();
        void refreshReviewHealth();
      }
    },3000);
    return () => {
      window.removeEventListener('hashchange',onHash);
      window.removeEventListener('focus',onFocus);
      document.removeEventListener('visibilitychange',onFocus);
      clearInterval(timer);
    };
  },[refresh,refreshReviewHealth]);

  useEffect(()=>{ if (!toast) return; const timer=setTimeout(()=>setToast(null),4000); return ()=>clearTimeout(timer); },[toast]);

  const notify = useCallback((message:string,tone:Tone='success')=>setToast({message,tone}),[]);
  const go = useCallback((next:Tab)=>{ window.location.hash = next; },[]);
  const page = pages[tab];
  const failing = data?.overview.checks.filter(c=>c.level==='fail').length || 0;

  return <div className="shell">
    <a className="skip-link" href="#main">跳到主要内容</a>
    <aside className={navOpen?'sidebar open':'sidebar'} aria-label="主导航">
      <div className="brand"><span className="brand-mark" aria-hidden="true">笙</span><div><strong>三笙 AI</strong><span>提示词强化管理台</span></div></div>
      <nav>{groups.map(group=><div className="nav-group" key={group.label}><span className="nav-group-label">{group.label}</span>
        {group.tabs.map(key=><a key={key} href={`#${key}`} className={tab===key?'nav-item active':'nav-item'} aria-current={tab===key?'page':undefined}>
          <Icon name={pages[key].icon}/><span>{pages[key].title}</span>
          {key==='overview'&&failing>0&&<span className="nav-count" aria-label={`${failing} 项阻断`}>{failing}</span>}
        </a>)}</div>)}</nav>
      <div className="sidebar-foot"><span className="dot" aria-hidden="true"/>仅本机可访问</div>
    </aside>
    {navOpen&&<button className="scrim" aria-label="关闭导航" onClick={()=>setNavOpen(false)}/>}
    <div className="workspace">
      <header className="topbar">
        <button className="btn btn-ghost btn-icon nav-toggle" onClick={()=>setNavOpen(true)} aria-label="打开导航"><Icon name="menu"/></button>
        <div className="topbar-title"><h1>{page.title}</h1><p>{page.description}</p></div>
        <div className="topbar-actions">
          {tab.startsWith('review')&&reviewHealth&&(reviewHealth.mode==='live'?<Badge tone="info" icon={false}>真实 API 模式</Badge>:<Badge icon={false}>模拟模式</Badge>)}
        </div>
      </header>
      <main id="main" className="content" tabIndex={-1}>
        {loadError&&<Alert tone="danger">{loadError}。<button className="link" onClick={()=>void refresh()}>重试</button></Alert>}
        {!data?(!loadError&&<div className="skeleton-page" aria-busy="true" aria-label="正在加载"><div className="skeleton row"/><div className="skeleton block"/><div className="skeleton block"/></div>):<>
          {tab==='overview'&&<Overview data={data} go={go}/>}
          {tab==='runs'&&<RunsView runs={data.runs} scenes={data.scenes} models={data.config.models}/>}
          {tab==='playground'&&<Playground data={data} refresh={refresh}/>}
          {tab==='intent'&&<IntentConfigView notify={notify} confirm={confirm} go={go}/>}
          {tab==='prompts'&&<PromptsView prompts={data.prompts} refresh={refresh} notify={notify} confirm={confirm} go={go}/>}
          {tab==='models'&&<ModelsView config={data.config} refresh={refresh} notify={notify} confirm={confirm}/>}
          {tab==='scenes'&&<ScenesView scenes={data.scenes} refresh={refresh} notify={notify}/>}
          {tab==='settings'&&<SettingsView config={data.config} refresh={refresh} notify={notify}/>}
          {tab==='audit'&&<AuditView audit={data.audit}/>}
          {tab==='review'&&reviewHealth&&<ReviewWorkbench health={reviewHealth} refreshHealth={refreshReviewHealth} refreshConsole={refresh}/>}
          {tab==='review-records'&&<ReviewRecords/>}
          {tab==='review-rules'&&<ReviewRules notify={notify} confirm={confirm} refreshHealth={refreshReviewHealth}/>}
        </>}
      </main>
    </div>
    {toast&&<div className={`toast toast-${toast.tone}`} role="status"><Icon name={toast.tone==='danger'?'fail':'ok'} size={16}/>{toast.message}<button className="btn btn-ghost btn-icon" onClick={()=>setToast(null)} aria-label="关闭提示"><Icon name="close" size={14}/></button></div>}
    {confirmDialog}
  </div>;
}
