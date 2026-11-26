'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Tone } from './lib';

/** Stroke icons (24px grid, Lucide-style geometry). Decorative unless a label is given. */
const paths: Record<string,ReactNode> = {
  overview:<><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></>,
  playground:<><path d="M9 3h6"/><path d="M10 3v6l-5.6 9.4A2 2 0 0 0 6.1 21.5h11.8a2 2 0 0 0 1.7-3.1L14 9V3"/><path d="M7.5 15h9"/></>,
  prompts:<><path d="M14 3H6.5A2.5 2.5 0 0 0 4 5.5v13A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V9z"/><path d="M14 3v6h6"/><path d="M8 13h8M8 17h5"/></>,
  models:<><rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/></>,
  scenes:<><path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/></>,
  settings:<><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></>,
  runs:<><path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/></>,
  audit:<><path d="M3 12a9 9 0 1 0 2.7-6.4L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></>,
  refresh:<><path d="M20 11a8 8 0 0 0-14.3-4.5L4 8"/><path d="M4 3v5h5"/><path d="M4 13a8 8 0 0 0 14.3 4.5L20 16"/><path d="M20 21v-5h-5"/></>,
  ok:<><circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.8 2.8L16 9.5"/></>,
  warn:<><path d="M10.3 3.9 2.4 17.6A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-2.9L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4M12 17h.01"/></>,
  fail:<><circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/></>,
  info:<><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></>,
  plus:<path d="M12 5v14M5 12h14"/>,
  close:<path d="M6 6l12 12M18 6 6 18"/>,
  chevron:<path d="m9 6 6 6-6 6"/>,
  play:<path d="M7 4.5v15l12.5-7.5z"/>,
  menu:<path d="M4 6h16M4 12h16M4 18h16"/>,
  copy:<><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5.5A2.5 2.5 0 0 1 7.5 3H15"/></>,
  shield:<><path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6z"/><path d="m9 12 2.2 2.2L15.5 10"/></>,
  inbox:<><path d="M3 13h5l1.5 3h5L16 13h5"/><path d="M5.2 5h13.6L21 13v5.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5V13z"/></>,
  rules:<><rect x="5" y="3.5" width="14" height="17" rx="2"/><path d="M9 8h6M9 12h6M9 16h3.5"/></>,
};

export function Icon({name,size=18,label}:{name:keyof typeof paths;size?:number;label?:string}) {
  return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
    strokeLinecap="round" strokeLinejoin="round" role={label?'img':undefined} aria-label={label} aria-hidden={label?undefined:true}>{paths[name]}</svg>;
}

const toneIcon: Record<Tone,keyof typeof paths|null> = {success:'ok',warning:'warn',danger:'fail',info:'info',neutral:null};

/** Status pill: always text (and an icon for semantic tones), never color alone. */
export function Badge({tone='neutral',children,icon=true}:{tone?:Tone;children:ReactNode;icon?:boolean}) {
  const name = icon ? toneIcon[tone] : null;
  return <span className={`badge badge-${tone}`}>{name&&<Icon name={name} size={13}/>}{children}</span>;
}

export function Card({title,description,actions,children,className='',flush=false}:{title?:ReactNode;description?:ReactNode;actions?:ReactNode;children:ReactNode;className?:string;flush?:boolean}) {
  return <section className={`card ${className}`}>
    {(title||actions)&&<header className="card-head"><div>{title&&<h2>{title}</h2>}{description&&<p>{description}</p>}</div>{actions&&<div className="card-actions">{actions}</div>}</header>}
    <div className={flush?'card-body flush':'card-body'}>{children}</div>
  </section>;
}

export function EmptyState({title,children,action}:{title:string;children?:ReactNode;action?:ReactNode}) {
  return <div className="empty"><strong>{title}</strong>{children&&<p>{children}</p>}{action}</div>;
}

export function Field({label,htmlFor,hint,error,children,aside}:{label:string;htmlFor:string;hint?:ReactNode;error?:string;children:ReactNode;aside?:ReactNode}) {
  return <div className={error?'field has-error':'field'}>
    <div className="field-label"><label htmlFor={htmlFor}>{label}</label>{aside&&<span className="field-aside">{aside}</span>}</div>
    {children}
    {error?<p className="field-error" role="alert">{error}</p>:hint&&<p className="field-hint">{hint}</p>}
  </div>;
}

export function Toggle({checked,onChange,label,id}:{checked:boolean;onChange:(value:boolean)=>void;label:string;id?:string}) {
  return <button type="button" id={id} role="switch" aria-checked={checked} aria-label={label} className={checked?'toggle on':'toggle'} onClick={()=>onChange(!checked)}><span/></button>;
}

export function Spinner() { return <span className="spinner" aria-hidden="true"/>; }

export function Alert({tone='info',children}:{tone?:Tone;children:ReactNode}) {
  const name = toneIcon[tone] || 'info';
  return <div className={`alert alert-${tone}`} role={tone==='danger'?'alert':'status'}><Icon name={name} size={16}/><div>{children}</div></div>;
}

export function Stat({label,value,detail}:{label:string;value:ReactNode;detail?:ReactNode}) {
  return <div className="stat"><span className="stat-label">{label}</span><strong className="stat-value">{value}</strong>{detail&&<span className="stat-detail">{detail}</span>}</div>;
}

type ConfirmOptions = {title:string;body:ReactNode;confirmLabel:string;danger?:boolean};
export type ConfirmFn = (options:ConfirmOptions)=>Promise<boolean>;

/** Modal confirmation on a native <dialog> (focus trap and Esc come from the browser). */
export function useConfirm(): [ReactNode,(options:ConfirmOptions)=>Promise<boolean>] {
  const ref = useRef<HTMLDialogElement>(null);
  const resolver = useRef<((value:boolean)=>void)|null>(null);
  const [options,setOptions] = useState<ConfirmOptions|null>(null);
  useEffect(()=>{ if (options && ref.current && !ref.current.open) ref.current.showModal(); },[options]);
  const close = useCallback((value:boolean)=>{ ref.current?.close(); resolver.current?.(value); resolver.current=null; setOptions(null); },[]);
  const confirm = useCallback((next:ConfirmOptions)=>new Promise<boolean>(resolve=>{ resolver.current=resolve; setOptions(next); }),[]);
  const element = <dialog ref={ref} className="dialog" onCancel={e=>{e.preventDefault();close(false);}} aria-labelledby="confirm-title">
    {options&&<form method="dialog" onSubmit={e=>{e.preventDefault();close(true);}}>
      <h2 id="confirm-title">{options.title}</h2>
      <div className="dialog-body">{options.body}</div>
      <div className="dialog-actions"><button type="button" className="btn btn-secondary" onClick={()=>close(false)}>取消</button>
        <button type="submit" className={options.danger?'btn btn-danger':'btn btn-primary'} autoFocus>{options.confirmLabel}</button></div>
    </form>}
  </dialog>;
  return [element,confirm];
}

export function Drawer({open,title,onClose,children}:{open:boolean;title:ReactNode;onClose:()=>void;children:ReactNode}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(()=>{ const node=ref.current; if (!node) return; if (open && !node.open) node.showModal(); if (!open && node.open) node.close(); },[open]);
  return <dialog ref={ref} className="drawer" onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if (e.target===ref.current) onClose();}} aria-labelledby="drawer-title">
    <div className="drawer-panel"><header className="drawer-head"><h2 id="drawer-title">{title}</h2><button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label="关闭"><Icon name="close"/></button></header>
      <div className="drawer-body">{children}</div></div>
  </dialog>;
}
