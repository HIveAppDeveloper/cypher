import { useEffect, useRef, useState } from 'react';
import { GlassSelect } from './GlassSelect';
export interface Appearance { accent:string; fontSize:number; width:number; density:string; motion:boolean; }
export const DEFAULT_APPEARANCE:Appearance={accent:'#1d1d1f',fontSize:16,width:88,density:'comfortable',motion:true};
function readAppearance():Appearance{try{const saved={...DEFAULT_APPEARANCE,...JSON.parse(localStorage.getItem('grokbot-appearance')||'{}')};return {...saved,accent:DEFAULT_APPEARANCE.accent};}catch{return DEFAULT_APPEARANCE;}}
export function applyAppearance(value:Appearance){const root=document.documentElement;root.style.removeProperty('--accent-blue');root.style.removeProperty('--focus-color');root.style.setProperty('--chat-font-size',`${value.fontSize}px`);root.style.setProperty('--message-width',`${value.width}%`);root.dataset.density=value.density;root.dataset.motion=String(value.motion);}
export function restoreAppearance(){applyAppearance(readAppearance());}
export function PreferencesPanel({onClose,onSetup}:{onClose:()=>void;onSetup?:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null);const [value,setValue]=useState(DEFAULT_APPEARANCE);
 useEffect(()=>{const previous=document.activeElement as HTMLElement;dialog.current?.showModal();setValue(readAppearance());return()=>{dialog.current?.close();previous?.focus();};},[]);
 function update(next:Appearance){setValue(next);applyAppearance(next);try{localStorage.setItem('grokbot-appearance',JSON.stringify(next));}catch{}}
 const textSize=value.fontSize<16?'Small':value.fontSize===16?'Default':value.fontSize<20?'Large':'Extra large';
 return <dialog ref={dialog} className="bot-dialog preferences-dialog" onCancel={onClose} aria-labelledby="appearance-title">
  <h2 id="appearance-title">Settings</h2>
  <p className="dialog-intro">Make Cypher comfortable to use. Changes are saved in this browser.</p>
  <div className="agent-form"><div className="agent-form-fields">
   <label>Message text size <output>{textSize}</output><input aria-label="Message text size" type="range" min="14" max="22" value={value.fontSize} onChange={e=>update({...value,fontSize:+e.target.value})}/></label>
   <label className="check-row"><input type="checkbox" checked={value.motion} onChange={e=>update({...value,motion:e.target.checked})}/>Show animations</label>
   <details className="simple-disclosure"><summary>More display options</summary><div className="simple-options-body">
    <label htmlFor="density">Assistant list spacing</label><GlassSelect id="density" value={value.density} onChange={e=>update({...value,density:e.target.value})}><option value="compact">Close together</option><option value="comfortable">Default</option><option value="spacious">More space</option></GlassSelect>
    <label>Message width on larger screens <output>{value.width}%</output><input aria-label="Message width" type="range" min="60" max="100" value={value.width} onChange={e=>update({...value,width:+e.target.value})}/></label>
   </div></details>
   {onSetup?<details className="simple-disclosure"><summary>Advanced setup</summary><div className="simple-options-body"><p className="field-help">Check Cypher’s connection or manage the AI accounts used by this installation.</p><button type="button" className="btn-secondary" onClick={onSetup}>Connection and AI settings</button></div></details>:null}
  </div><div className="dialog-actions"><button type="button" className="btn-secondary" onClick={()=>update(DEFAULT_APPEARANCE)}>Reset display settings</button><button type="button" className="btn-primary" onClick={onClose}>Done</button></div></div>
 </dialog>;
}
