'use client';
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';

const STORAGE_KEY = 'grokbot-sidebar-layout-v1';
const DEFAULT_WIDTH = 280;
const MIN_WIDTH = 220;
const MAX_WIDTH = 480;
const CHAT_MIN_WIDTH = 360;
const WIDTH_STEP = 16;
type Side = 'left' | 'right';
type Layout = { side: Side; width: number; collapsed: boolean };
const DEFAULT_LAYOUT: Layout = { side: 'left', width: DEFAULT_WIDTH, collapsed: false };
function clampWidth(width: number) {
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, window.innerWidth - CHAT_MIN_WIDTH, width));
}

export function SidebarShell({ children }: { children: ReactNode }) {
  const [layout, setLayout] = useState<Layout>(DEFAULT_LAYOUT);
  const [loaded, setLoaded] = useState(false);
  const [preview, setPreview] = useState<Side | null>(null);
  const [resizing, setResizing] = useState(false);
  const resizeStart = useRef<{ x: number; width: number } | null>(null);
  const dockStart = useRef<number | null>(null);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (saved) setLayout({
        side: saved.side === 'right' ? 'right' : 'left',
        width: Number.isFinite(saved.width) ? Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, saved.width)) : DEFAULT_WIDTH,
        collapsed: saved.collapsed === true,
      });
    } catch {}
    setLoaded(true);
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b' && !event.altKey && !event.shiftKey && !(event.target instanceof HTMLElement && event.target.closest('input,textarea,[contenteditable=true]'))) {
        event.preventDefault(); setLayout(current => ({ ...current, collapsed: !current.collapsed }));
      }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, []);
  useEffect(() => { if (loaded) try { localStorage.setItem(STORAGE_KEY, JSON.stringify(layout)); } catch {} }, [layout, loaded]);
  function resize(event: PointerEvent<HTMLDivElement>) {
    if (!resizeStart.current) return;
    const start = resizeStart.current;
    const delta = (event.clientX - start.x) * (layout.side === 'left' ? 1 : -1);
    const width = clampWidth(start.width + delta);
    setLayout(current => ({ ...current, width }));
  }
  function endResize() { resizeStart.current = null; setResizing(false); }
  function endDock(event: PointerEvent<HTMLButtonElement>) {
    if (dockStart.current !== null && Math.abs(event.clientX - dockStart.current) > WIDTH_STEP) {
      setLayout(current => ({ ...current, side: event.clientX < window.innerWidth / 2 ? 'left' : 'right' }));
    }
    dockStart.current = null; setPreview(null);
  }
  return <section className="sidebar-shell" aria-label="Workspace sidebar" data-side={layout.side} data-collapsed={layout.collapsed} data-resizing={resizing} style={{ '--sidebar-width': `${layout.width}px` } as CSSProperties}>
    <div className="sidebar-layout-tools" aria-label="Sidebar layout">
      <button className="sidebar-drag" aria-label="Drag sidebar to either side" title="Drag to dock on either side" onPointerDown={event => { if(event.button !== 0)return; dockStart.current=event.clientX; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={event => { if(dockStart.current !== null && Math.abs(event.clientX-dockStart.current)>WIDTH_STEP)setPreview(event.clientX<window.innerWidth/2?'left':'right'); }} onPointerUp={endDock} onPointerCancel={()=>{dockStart.current=null;setPreview(null);}} onLostPointerCapture={()=>{dockStart.current=null;setPreview(null);}}><svg viewBox="0 0 24 24"><path d="M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01"/></svg></button>
      <button aria-label={`Move sidebar to ${layout.side === 'left' ? 'right' : 'left'}`} title={`Move sidebar to ${layout.side === 'left' ? 'right' : 'left'}`} onClick={()=>setLayout(current=>({...current,side:current.side==='left'?'right':'left'}))}><svg viewBox="0 0 24 24"><path d={layout.side==='left'?'M4 12h16m-6-6 6 6-6 6':'M20 12H4m6-6-6 6 6 6'}/></svg></button>
      <button aria-label={layout.collapsed?'Expand sidebar':'Collapse sidebar'} aria-expanded={!layout.collapsed} title={`${layout.collapsed?'Expand':'Collapse'} sidebar (⌘/Ctrl B)`} onClick={()=>setLayout(current=>({...current,collapsed:!current.collapsed}))}><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="3"/><path d={layout.side==='left'?'M9 4v16':'M15 4v16'}/></svg></button>
      <button className="sidebar-reset" aria-label="Reset sidebar layout" title="Reset sidebar layout" onClick={()=>setLayout(DEFAULT_LAYOUT)}><svg viewBox="0 0 24 24"><path d="M4 10a8 8 0 1 1 1 8M4 4v6h6"/></svg></button>
    </div>
    {children}
    {!layout.collapsed ? <div className="sidebar-resize-handle" role="separator" tabIndex={0} aria-label="Resize sidebar" aria-orientation="vertical" aria-valuemin={MIN_WIDTH} aria-valuemax={MAX_WIDTH} aria-valuenow={Math.round(layout.width)} aria-valuetext={`${Math.round(layout.width)} pixels`} title="Drag to resize · double-click to reset" onDoubleClick={()=>setLayout(current=>({...current,width:DEFAULT_WIDTH}))} onPointerDown={event=>{if(event.button!==0)return;resizeStart.current={x:event.clientX,width:event.currentTarget.parentElement!.getBoundingClientRect().width};setResizing(true);event.currentTarget.setPointerCapture(event.pointerId);event.preventDefault();}} onPointerMove={resize} onPointerUp={endResize} onPointerCancel={endResize} onLostPointerCapture={endResize} onKeyDown={event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const delta=(event.key==='ArrowRight'?WIDTH_STEP:-WIDTH_STEP)*(layout.side==='left'?1:-1);setLayout(current=>({...current,width:clampWidth(event.key==='Home'?MIN_WIDTH:event.key==='End'?MAX_WIDTH:current.width+delta)}));}}/> : null}
    {preview ? <div className="sidebar-dock-preview" role="status" data-side={preview}>Release to dock {preview}</div> : null}
  </section>;
}
