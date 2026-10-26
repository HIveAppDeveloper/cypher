export type Theme = 'system' | 'light' | 'dark';
export interface Appearance { accent:string; fontSize:number; width:number; density:string; motion:boolean; theme:Theme; }
export const DEFAULT_APPEARANCE:Appearance={accent:'#1d1d1f',fontSize:16,width:88,density:'comfortable',motion:true,theme:'system'};
export function readAppearance():Appearance {
  try {
    const raw=JSON.parse(localStorage.getItem('grokbot-appearance')||'{}');
    const saved=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};
    return {...DEFAULT_APPEARANCE,...saved,accent:DEFAULT_APPEARANCE.accent,
      theme:['light','dark','system'].includes(saved.theme)?saved.theme:'system'};
  } catch { return DEFAULT_APPEARANCE; }
}
export function applyAppearance(value:Appearance) {
  const root=document.documentElement;
  root.style.removeProperty('--accent-blue');root.style.removeProperty('--focus-color');
  root.style.setProperty('--chat-font-size',`${value.fontSize}px`);root.style.setProperty('--message-width',`${value.width}%`);
  root.dataset.density=value.density;root.dataset.motion=String(value.motion);
  const dark=value.theme==='dark'||(value.theme==='system'&&typeof window!=='undefined'&&window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  root.dataset.theme=dark?'dark':'light';root.style.colorScheme=dark?'dark':'light';
}
export function restoreAppearance(){applyAppearance(readAppearance());}

// Runs before paint. This body is deliberately self-contained and uses no saved HTML.
export function initializeTheme() {
  try {
    const saved=JSON.parse(localStorage.getItem('grokbot-appearance')||'{}');
    const preference=saved&&saved.theme;
    const dark=preference==='dark'||(preference!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme=dark?'dark':'light';
    document.documentElement.style.colorScheme=dark?'dark':'light';
  } catch {
    const dark=window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme=dark?'dark':'light';document.documentElement.style.colorScheme=dark?'dark':'light';
  }
}
export const THEME_BOOTSTRAP=`(${initializeTheme.toString()})();`;
