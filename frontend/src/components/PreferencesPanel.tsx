import { useEffect, useRef, useState } from 'react';
import { GlassSelect } from './GlassSelect';
import {DEFAULT_APPEARANCE,readAppearance,applyAppearance,type Appearance} from '../lib/appearance';
export {DEFAULT_APPEARANCE,applyAppearance,restoreAppearance} from '../lib/appearance';
export type {Appearance} from '../lib/appearance';
import styles from './PreferencesPanel.module.css';
export function PreferencesPanel({onClose,onSetup}:{onClose:()=>void;onSetup?:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null);const [value,setValue]=useState(DEFAULT_APPEARANCE);const [systemDark,setSystemDark]=useState(false);
 useEffect(()=>{const previous=document.activeElement as HTMLElement;dialog.current?.showModal();setValue(readAppearance());return()=>{dialog.current?.close();previous?.focus();};},[]);
 useEffect(()=>{const scheme=window.matchMedia('(prefers-color-scheme: dark)');const change=()=>setSystemDark(scheme.matches);change();scheme.addEventListener('change',change);return()=>scheme.removeEventListener('change',change);},[]);
 function update(next:Appearance){setValue(next);applyAppearance(next);try{localStorage.setItem('grokbot-appearance',JSON.stringify(next));}catch{}}
 const textSize=value.fontSize<16?'Small':value.fontSize===16?'Default':value.fontSize<20?'Large':'Extra large';
 return <dialog ref={dialog} className={`bot-dialog preferences-dialog ${styles.panel}`} onCancel={onClose} aria-labelledby="appearance-title">
  <h2 id="appearance-title">Settings</h2>
  <p className="dialog-intro">Make Cypher comfortable to use. Changes are saved in this browser.</p>
  <div className="agent-form"><div className="agent-form-fields">
   <section className={styles.theme} aria-labelledby="theme-title"><div><strong id="theme-title">Dark mode</strong><p>{value.theme==='system'?'Following your device appearance.':'Saved for this browser.'}</p></div><label className={styles.switchArea}><input type="checkbox" role="switch" aria-label="Dark mode" checked={value.theme==='dark'||(value.theme==='system'&&systemDark)} onChange={e=>update({...value,theme:e.target.checked?'dark':'light'})}/></label><button type="button" className={styles.system} disabled={value.theme==='system'} onClick={()=>update({...value,theme:'system'})}>Use device theme</button></section>
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
