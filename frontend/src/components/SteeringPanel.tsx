import { useEffect, useState } from 'react';
import { GlassSelect } from './GlassSelect';
import { Job, RunOptions } from '../lib/types';
import { api } from '../lib/api';
function formatInstruction(brief:string,constraints:string,style:string){
  return [brief.trim()&&`Outcome: ${brief.trim()}`,constraints.trim()&&`Constraints: ${constraints.trim()}`,style==='concise'?'Reply briefly with the result first.':style==='detailed'?'Include reasoning, evidence, and useful detail.':'Give the finished deliverable with only essential notes.'].filter(Boolean).join('\n');
}
function workingPace(effort:string|undefined){return effort==='low'?'low':['high','xhigh','max'].includes(effort||'')?'high':'medium';}
const reasoningEfforts=new Set(['none','low','medium','high','xhigh','max','ultra']);
export function SteeringPanel({conversationId,jobs,options,onChange,initiallyOpen=false}:{initiallyOpen?:boolean;conversationId:string;jobs:Job[];options:RunOptions;onChange:(options:RunOptions)=>void}) {
  const [expanded,setExpanded]=useState(initiallyOpen);
  const [brief,setBrief]=useState('');
  const [style,setStyle]=useState('concise');
  const [effort,setEffort]=useState(workingPace(options.reasoning_effort));
  const [preservedEffort,setPreservedEffort]=useState(options.reasoning_effort||'medium');
  const [effortEdited,setEffortEdited]=useState(false);
  const [constraints,setConstraints]=useState('');
  const [target,setTarget]=useState('');
  const [notice,setNotice]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const active=jobs.filter(job=>['pending','running'].includes(job.status));
  useEffect(()=>{
    let saved:{brief?:unknown;style?:unknown;effort?:unknown;reasoning_effort?:unknown;constraints?:unknown}|null=null;
    try{const value=JSON.parse(localStorage.getItem('grokbot-brief-'+conversationId)||'null');if(value&&typeof value==='object'&&!Array.isArray(value))saved=value;}catch{}
    const nextBrief=typeof saved?.brief==='string'?saved.brief:'';
    const nextConstraints=typeof saved?.constraints==='string'?saved.constraints:'';
    const nextStyle=saved?.style==='detailed'?'detailed':saved?.style==='deliverable'?'deliverable':'concise';
    const hasSaved=!!saved&&['brief','constraints','style','effort'].some(key=>Object.prototype.hasOwnProperty.call(saved,key));
    const savedPace=typeof saved?.effort==='string'&&['low','medium','high'].includes(saved.effort)?saved.effort:null;
    const savedReasoning=typeof saved?.reasoning_effort==='string'&&reasoningEfforts.has(saved.reasoning_effort)?saved.reasoning_effort:null;
    const nextReasoningEffort=savedPace&&savedReasoning&&workingPace(savedReasoning)!==savedPace?savedPace:savedReasoning||savedPace||options.reasoning_effort||'medium';
    const nextEffort=savedPace||workingPace(nextReasoningEffort);
    setBrief(nextBrief);setStyle(nextStyle);setEffort(nextEffort);setPreservedEffort(nextReasoningEffort);setEffortEdited(false);setConstraints(nextConstraints);setTarget('');setNotice('');setError('');
    onChange({...options,steering:hasSaved?formatInstruction(nextBrief,nextConstraints,nextStyle):'',reasoning_effort:nextReasoningEffort});
  },[conversationId]);
  const targetId=active.some(job=>job.id===target)?target:active[0]?.id;
  const instruction=formatInstruction(brief,constraints,style);
  function save(){const reasoningEffort=effortEdited?effort:preservedEffort;setError('');setNotice('');onChange({...options,steering:instruction,reasoning_effort:reasoningEffort});try{localStorage.setItem('grokbot-brief-'+conversationId,JSON.stringify({brief,style,effort,constraints,reasoning_effort:reasoningEffort}));setPreservedEffort(reasoningEffort);setEffortEdited(false);setNotice('Saved for your next messages in this thread.');}catch{setError('Your brief is active for this conversation, but could not be saved in this browser.');}}
  function clear(){const reasoningEffort=effortEdited?effort:preservedEffort;setBrief('');setConstraints('');setStyle('concise');setEffort(workingPace(reasoningEffort));setPreservedEffort(reasoningEffort);setEffortEdited(false);setError('');onChange({...options,steering:'',reasoning_effort:reasoningEffort});try{localStorage.removeItem('grokbot-brief-'+conversationId);setNotice('Brief cleared.');}catch{setNotice('');setError('Brief cleared for this conversation, but its saved copy could not be removed from this browser.');}}
  async function steer(){const id=targetId;if(!id)return;setBusy(true);setError('');try{await api.steerJob(conversationId,id,instruction);setNotice('Direction sent. It takes effect at the next model or tool step; it cannot undo actions already underway.');}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}
  return <details className="thread-steering" open={expanded} onToggle={event=>setExpanded(event.currentTarget.open)}><summary>Steer your team <span>{options.steering?'Brief set':'Outcome, priorities, and boundaries'}</span></summary><div className="steering-fields"><label htmlFor="steering-outcome">What matters most?</label><textarea id="steering-outcome" rows={2} maxLength={2400} value={brief} onChange={e=>setBrief(e.target.value)} placeholder="The outcome you want. What should they focus on?"/><label htmlFor="steering-constraints">Boundaries and must-haves</label><textarea id="steering-constraints" rows={2} maxLength={2400} value={constraints} onChange={e=>setConstraints(e.target.value)} placeholder="Deadline, audience, things to avoid, or a spending limit."/><div className="steering-choices"><label>Working pace<GlassSelect aria-label="Working pace" value={effort} onChange={e=>{setEffort(e.target.value);setEffortEdited(true);}}><option value="low">Quick pass</option><option value="medium">Balanced</option><option value="high">Think it through</option></GlassSelect></label><label>How they reply<GlassSelect aria-label="Reply style" value={style} onChange={e=>setStyle(e.target.value)}><option value="concise">Short updates</option><option value="detailed">Full explanation</option><option value="deliverable">Finished work</option></GlassSelect></label></div><p className="field-help">Pace changes thinking effort for future messages. Written spending limits guide the agent; they are not billing caps.</p><div className="steering-actions"><button className="btn-primary" onClick={save} disabled={busy}>Use for next messages</button><button className="btn-secondary" onClick={clear} disabled={busy}>Clear brief</button></div>{active.length?<div className="steering-current">{active.length>1?<label>Current task<GlassSelect aria-label="Task to steer" value={targetId} onChange={e=>setTarget(e.target.value)}>{active.map(job=><option value={job.id} key={job.id}>{job.title}</option>)}</GlassSelect></label>:null}<button className="btn-secondary" disabled={busy} onClick={()=>void steer()}>{busy?'Sending direction…':'Send direction to current work'}</button><p className="field-help">Sends this brief to the selected active task. Media generation already underway cannot be redirected.</p></div>:null}{notice?<p role="status" className="field-help">{notice}</p>:null}{error?<p role="alert" className="form-error">{error}</p>:null}</div></details>;
}
