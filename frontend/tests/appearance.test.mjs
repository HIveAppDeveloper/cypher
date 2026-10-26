import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

test('legacy accent preferences cannot recolor Cypher while personal layout and motion settings survive', () => {
  const source = readFileSync(new URL('../src/lib/appearance.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
  for (const accent of ['#007aff', '#7054dc']) {
    const styles = new Map([['--accent-blue', accent], ['--focus-color', accent]]);
    const root = { dataset: {}, style: { setProperty: (key, value) => styles.set(key, value), removeProperty: key => styles.delete(key) } };
    const exports = {};
    runInNewContext(compiled, { exports, require: name => { if (name === 'react' || name === './GlassSelect') return {}; throw Error(name); },
      document: { documentElement: root }, localStorage: { getItem: () => JSON.stringify({ accent, fontSize: 20, width: 75, density: 'compact', motion: false }) } });
    exports.restoreAppearance();
    assert.equal(styles.has('--accent-blue'), false);
    assert.equal(styles.has('--focus-color'), false);
    assert.equal(styles.get('--chat-font-size'), '20px');
    assert.equal(styles.get('--message-width'), '75%');
    assert.equal(root.dataset.density, 'compact');
    assert.equal(root.dataset.motion, 'false');
  }
});

function themeFixture(saved,systemDark=false,blocked=false) {
  const source=readFileSync(new URL('../src/lib/appearance.ts',import.meta.url),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  const root={dataset:{},style:{setProperty(){},removeProperty(){}}};
  const window={matchMedia:()=>({matches:systemDark})};
  const exports={};
  const context={exports,document:{documentElement:root},window,
    localStorage:{getItem(){if(blocked)throw Error('Storage unavailable');return saved;}}};
  runInNewContext(compiled,context);
  return {exports,root,window,context};
}

test('explicit light and dark preferences override the device in both bootstrap and restoration',()=>{
 for(const systemDark of [true,false])for(const theme of ['dark','light']){
  const f=themeFixture(JSON.stringify({theme,fontSize:19,width:73,density:'compact',motion:false}),systemDark);
  runInNewContext(f.exports.THEME_BOOTSTRAP,f.context);
  assert.equal(f.root.dataset.theme,theme);assert.equal(f.root.style.colorScheme,theme);
  f.exports.restoreAppearance();assert.equal(f.root.dataset.theme,theme);
  assert.equal(f.exports.readAppearance().fontSize,19);
  assert.equal(f.root.dataset.motion,'false');
 }
});

test('legacy, corrupt, and blocked storage follow device theme and bootstrap stays executable',()=>{
 for(const saved of ['{}','null','[]','invalid JSON','{"theme":"unknown"}'])for(const systemDark of [true,false]){
  const f=themeFixture(saved,systemDark);runInNewContext(f.exports.THEME_BOOTSTRAP,f.context);
  assert.equal(f.root.dataset.theme,systemDark?'dark':'light');
  f.exports.restoreAppearance();assert.equal(f.root.dataset.theme,systemDark?'dark':'light');
 }
 const blocked=themeFixture('{}',true,true);runInNewContext(blocked.exports.THEME_BOOTSTRAP,blocked.context);
 blocked.exports.restoreAppearance();assert.equal(blocked.root.dataset.theme,'dark');
});

test('device-theme changes apply in system mode without replacing an explicit preference',()=>{
 const f=themeFixture('{"theme":"system"}',false);
 f.exports.restoreAppearance();assert.equal(f.root.dataset.theme,'light');
 f.window.matchMedia=()=>({matches:true});f.exports.restoreAppearance();assert.equal(f.root.dataset.theme,'dark');
 f.exports.applyAppearance({...f.exports.DEFAULT_APPEARANCE,theme:'light'});assert.equal(f.root.dataset.theme,'light');
});

test('global appearance sync follows device and cross-tab changes, then removes its listeners',async()=>{
 const {environment,renderer,load,storage}=await import('./support/component-harness.mjs');
 const env=environment(),view=renderer(env),saved=storage({'grokbot-appearance':'{"theme":"system"}'});
 env.document.documentElement.style={setProperty(){},removeProperty(){}};
 const scheme=Object.assign(new EventTarget(),{matches:false});env.window.matchMedia=()=>scheme;
 const globals={...env.globals,localStorage:saved,React:view.react.default};
 const appearance=load('../src/lib/appearance.ts',{},globals);
 const {AppearanceSync}=load('../src/components/AppearanceSync.tsx',{react:view.react,'../lib/appearance':appearance},globals);
 view.mount(()=>AppearanceSync());assert.equal(env.document.documentElement.dataset.theme,'light');
 scheme.matches=true;scheme.dispatchEvent(new Event('change'));assert.equal(env.document.documentElement.dataset.theme,'dark');
 saved.setItem('grokbot-appearance','{"theme":"light"}');scheme.dispatchEvent(new Event('change'));
 assert.equal(env.document.documentElement.dataset.theme,'light');
 saved.setItem('grokbot-appearance','{"theme":"dark"}');const changed=new Event('storage');Object.defineProperty(changed,'key',{value:'grokbot-appearance'});env.window.dispatchEvent(changed);
 assert.equal(env.document.documentElement.dataset.theme,'dark');
 view.unmount();saved.setItem('grokbot-appearance','{"theme":"light"}');scheme.dispatchEvent(new Event('change'));env.window.dispatchEvent(changed);
 assert.equal(env.document.documentElement.dataset.theme,'dark');
});

test('an open Settings switch reflects cross-tab preferences and preserves the connection setup action',async()=>{
 const {environment,renderer,load,storage,find,button}=await import('./support/component-harness.mjs');
 const env=environment(),view=renderer(env),saved=storage({'grokbot-appearance':'{"theme":"light","width":79,"motion":false}'});
 env.document.documentElement.style={setProperty(){},removeProperty(){}};
 const scheme=Object.assign(new EventTarget(),{matches:false});env.window.matchMedia=()=>scheme;
 const globals={...env.globals,localStorage:saved,React:view.react.default};
 const appearance=load('../src/lib/appearance.ts',{},globals);
 const {PreferencesPanel}=load('../src/components/PreferencesPanel.tsx',{
  react:view.react,'../lib/appearance':appearance,'./GlassSelect':{GlassSelect:'select'},'./PreferencesPanel.module.css':{},
 },globals);
 let setups=0;view.mount(()=>PreferencesPanel({onClose(){},onSetup(){setups++;}}));await view.flush();
 assert.equal(find(view.tree,n=>n.props?.role==='switch').props.checked,false);
 saved.setItem('grokbot-appearance','{"theme":"dark","width":79,"motion":false}');
 const event=new Event('storage');Object.defineProperty(event,'key',{value:'grokbot-appearance'});env.window.dispatchEvent(event);await view.flush();
 assert.equal(find(view.tree,n=>n.props?.role==='switch').props.checked,true);
 assert.equal(find(view.tree,n=>n.props?.['aria-label']==='Message width').props.value,79);
 button(view.tree,'Connection and AI settings').props.onClick();assert.equal(setups,1);
 view.unmount();env.window.dispatchEvent(event);assert.equal(view.updatesAfterUnmount,0);
});
