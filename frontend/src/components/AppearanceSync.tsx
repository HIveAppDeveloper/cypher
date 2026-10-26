'use client';
import {useEffect} from 'react';
import {restoreAppearance} from '../lib/appearance';
export function AppearanceSync(){
 useEffect(()=>{
  const scheme=window.matchMedia('(prefers-color-scheme: dark)');
  const restore=()=>restoreAppearance();
  const storage=(event:StorageEvent)=>{if(event.key===null||event.key==='grokbot-appearance')restore();};
  restore();scheme.addEventListener('change',restore);window.addEventListener('storage',storage);
  return()=>{scheme.removeEventListener('change',restore);window.removeEventListener('storage',storage);};
 },[]);
 return null;
}
