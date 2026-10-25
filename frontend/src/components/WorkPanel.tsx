import { useEffect, useRef, useState } from 'react';
import { Job, RunOptions } from '../lib/types';
import { api } from '../lib/api';
import { dateFromApi } from '../lib/dates';
import { SteeringPanel } from './SteeringPanel';
const ACTIVE = new Set(['pending', 'running', 'cancel_requested']);
const LABELS: Record<string,string> = { pending:'Queued', running:'In progress', cancel_requested:'Stopping', completed:'Completed', failed:'Failed', cancelled:'Stopped', canceled:'Stopped', interrupted:'Interrupted' };
export function WorkPanel({open,onClose,conversationId,jobs,options,onChange,onRefresh}:{open:boolean;onClose:()=>void;conversationId:string;jobs:Job[];options:RunOptions;onChange:(options:RunOptions)=>void;onRefresh:()=>Promise<void>}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const [tab,setTab]=useState<'work'|'direction'>('work');
  const [busy,setBusy]=useState('');const [error,setError]=useState('');
  useEffect(()=>{if(open)dialog.current?.showModal();else dialog.current?.close();},[open]);
  async function stop(job:Job){setBusy(job.id);setError('');try{await api.cancelJob(conversationId,job.id);await onRefresh();}catch(failure){setError(failure instanceof Error?failure.message:'Could not stop this task. Try again.');}finally{setBusy('');}}
  const sorted=[...jobs].sort((a,b)=>Number(ACTIVE.has(b.status))-Number(ACTIVE.has(a.status)) || b.created_at.localeCompare(a.created_at));
  return <dialog ref={dialog} className="work-drawer" aria-labelledby="work-panel-title" onCancel={onClose} onClose={onClose} onClick={event=>{if(event.target===event.currentTarget)onClose();}}>
    <header><div><h2 id="work-panel-title">Work & direction</h2><p>Follow progress. Keep the team on track.</p></div><button className="icon-button" aria-label="Close work panel" onClick={onClose}><svg viewBox="0 0 24 24"><path d="m6 6 12 12M6 18 18 6"/></svg></button></header>
    <nav aria-label="Work panel pages"><button aria-pressed={tab==='work'} onClick={()=>setTab('work')}>Recent work <span>{jobs.length}</span></button><button aria-pressed={tab==='direction'} onClick={()=>setTab('direction')}>Direction</button></nav>
    <div className="work-drawer-body">{error?<p className="form-error" role="alert">{error}</p>:null}
      <section hidden={tab!=='work'}>{sorted.length?sorted.slice(0,30).map(job=><article className="work-item" key={job.id}><div className="work-item-meta"><span className="work-status" data-status={job.status}>{LABELS[job.status]||job.status.replaceAll('_',' ')}</span><time dateTime={job.created_at}>{dateFromApi(job.created_at)?.toLocaleDateString(undefined,{month:'short',day:'numeric'}) || '—'}</time></div><h3>{job.title||'Untitled task'}</h3>{['pending','running'].includes(job.status)?<button className="work-stop" disabled={!!busy} onClick={()=>void stop(job)}>{busy===job.id?'Stopping…':'Stop task'}</button>:null}{job.status==='failed'?<p>This task failed. Review the conversation for details before retrying.</p>:null}</article>):<div className="work-empty"><h3>No work yet</h3><p>Send a request in this conversation. Its progress will appear here.</p></div>}</section>
      <section hidden={tab!=='direction'}><p className="work-panel-intro">Set the outcome and constraints for future messages, or redirect a task already in progress.</p><SteeringPanel initiallyOpen conversationId={conversationId} jobs={jobs} options={options} onChange={onChange}/></section>
    </div>
  </dialog>;
}
