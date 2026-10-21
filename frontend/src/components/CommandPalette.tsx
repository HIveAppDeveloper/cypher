'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
export interface WorkspaceCommand { id: string; label: string; group: string; run: () => void; detail?: string; }
export function CommandPalette({ commands }: { commands: WorkspaceCommand[] }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [mounted,setMounted]=useState(false);
  useEffect(()=>{setMounted(true);},[]);
  const [selected, setSelected] = useState(0);
  const filtered = commands.filter(command => `${command.label} ${command.group} ${command.detail || ''}`.toLowerCase().includes(query.toLowerCase())).slice(0, 20);
  useEffect(()=>{if(dialog.current?.open)document.getElementById(`command-${filtered[selected]?.id}`)?.scrollIntoView({block:'nearest'});},[selected,query]);
  function open() { setQuery(''); setSelected(0); dialog.current?.showModal(); search.current?.focus(); }
  function choose(index: number) { const command = filtered[index]; if (!command) return; dialog.current?.close(); window.dispatchEvent(new Event('grokbot:navigate')); command.run(); }
  useEffect(() => {
    function shortcut(event: KeyboardEvent) { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); if (dialog.current?.open) dialog.current.close(); else open(); } }
    window.addEventListener('keydown', shortcut); return () => window.removeEventListener('keydown', shortcut);
  }, []);
  return <><button className="command-launcher" onClick={open}><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg><span>Search workspace</span><kbd>⌘ K</kbd></button>
    {mounted?createPortal(<dialog ref={dialog} className="command-dialog" aria-label="Search workspace" onClick={event => { if(event.target===event.currentTarget)dialog.current?.close(); }}>
      <div className="command-search"><input ref={search} aria-label="Find a conversation or action" role="combobox" aria-autocomplete="list" aria-controls="workspace-command-list" aria-expanded="true" aria-activedescendant={filtered[selected] ? `command-${filtered[selected].id}` : undefined} value={query} onChange={event => {setQuery(event.target.value);setSelected(0);}} placeholder="Find a conversation or action…" onKeyDown={event => {if(event.key==='ArrowDown'){event.preventDefault();setSelected(index=>Math.min(index+1,filtered.length-1));}if(event.key==='ArrowUp'){event.preventDefault();setSelected(index=>Math.max(0,index-1));}if(event.key==='Enter'){event.preventDefault();choose(selected);}}}/><button aria-label="Close search" onClick={()=>dialog.current?.close()}>Esc</button></div>
      <div id="workspace-command-list" role="listbox" aria-label="Workspace results" className="command-results">{filtered.map((command,index)=><button type="button" role="option" aria-selected={index===selected} id={`command-${command.id}`} key={command.id} onMouseEnter={()=>setSelected(index)} onClick={()=>choose(index)}><span><strong>{command.label}</strong>{command.detail?<small>{command.detail}</small>:null}</span><span className="command-group">{command.group}</span></button>)}{!filtered.length?<p>No matching conversations or actions.</p>:null}</div><footer>Use arrow keys to move. Enter to open.</footer>
    </dialog>,document.body):null}</>;
}
