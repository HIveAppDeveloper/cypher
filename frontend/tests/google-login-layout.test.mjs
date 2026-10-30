import {test} from 'node:test';
import assert from 'node:assert/strict';
import {environment,renderer,load,find,textOf} from './support/component-harness.mjs';

function fixture({width=354,available=true,renderThrows=false,observer=true}={}) {
  const env=environment(), view=renderer(env), calls=[], initializations=[], observers=[];
  const host={clientWidth:width,children:[],replaceChildren(){this.children=[];}};
  env.element=()=>host;
  const identity={
    initialize(options){initializations.push(JSON.parse(JSON.stringify(options)));},
    renderButton(parent,options){
      if(renderThrows)throw new Error('Synthetic provider render failure');
      calls.push(JSON.parse(JSON.stringify(options)));
      // GIS reserves space around the button's requested minimum width.
      parent.children.push({frameWidth:Number(options.width)+20});
    },
    prompt(){throw new Error('Layout must not open a sign-in prompt');},
  };
  if(available)env.window.google={accounts:{id:identity}};
  class Observer {
    constructor(callback){this.callback=callback;this.disconnected=false;observers.push(this);}
    observe(target){assert.equal(target,host);}
    disconnect(){this.disconnected=true;}
  }
  const {GoogleLogin}=load('../src/components/GoogleLogin.tsx',{
    react:view.react,'next/script':{__esModule:true,default:'script'},
  },{...env.globals,React:view.react.default,ResizeObserver:observer?Observer:undefined});
  let props={clientId:'synthetic.apps.googleusercontent.com',loginUri:'https://app.example/api/auth/google/callback?returnTo=%2Fworkspace'};
  view.mount(()=>GoogleLogin(props));
  const script=()=>find(view.tree,n=>n.type==='script');
  return {env,view,host,calls,initializations,observers,script,
    async ready(){assert.equal(typeof script().props.onReady,'function');script().props.onReady();await view.flush();},
    async resize(next){host.clientWidth=next;if(observer)observers.at(-1).callback();else env.window.dispatchEvent(new Event('resize'));await view.flush();},
    async update(next){props={...props,...next};view.rerender();await view.flush();},
  };
}

test('Google renderer keeps redirect and return path while waiting for the actual SDK',async()=>{
  const f=fixture();assert.equal(f.initializations.length,0);await f.ready();
  assert.deepEqual(f.initializations,[{client_id:'synthetic.apps.googleusercontent.com',login_uri:'https://app.example/api/auth/google/callback?returnTo=%2Fworkspace',ux_mode:'redirect',auto_select:false}]);
  assert.equal(f.calls[0].type,'standard');assert.equal(f.calls[0].shape,'pill');assert.equal(f.calls[0].text,'continue_with');
  f.view.unmount();
});

test('provider frame fits after desktop-to-phone resizing without duplicate buttons or reinitialization',async()=>{
  const f=fixture();await f.ready();
  for(const width of [354,308,238,354,900]){
    await f.resize(width);assert.equal(f.host.children.length,1);
    assert.ok(f.host.children[0].frameWidth<=width,`frame fits ${width}px host`);
    assert.ok(Number(f.calls.at(-1).width)<=400);
  }
  const count=f.calls.length;await f.resize(900);assert.equal(f.calls.length,count,'unchanged size does not render again');
  assert.equal(f.initializations.length,1,'resize preserves existing sign-in configuration');
  f.view.unmount();
});

test('hidden host waits for a measurable width and cached script readiness can initialize it',async()=>{
  const f=fixture({width:0});await f.ready();assert.equal(f.calls.length,0);
  await f.resize(308);assert.equal(f.host.children.length,1);
  await f.ready();assert.equal(f.initializations.length,1);
  f.view.unmount();
});

test('unmount disconnects resize work and ignores a late queued callback',async()=>{
  const f=fixture();await f.ready();const last=f.observers.at(-1), count=f.calls.length;
  f.view.unmount();assert.equal(last.disconnected,true);last.callback();
  assert.equal(f.calls.length,count);assert.equal(f.view.updatesAfterUnmount,0);
});

test('callback destination changes refresh configuration instead of using a stale return path',async()=>{
  const f=fixture();await f.ready();await f.update({loginUri:'https://app.example/api/auth/google/callback?returnTo=%2Flibrary'});
  assert.equal(f.initializations.at(-1).login_uri,'https://app.example/api/auth/google/callback?returnTo=%2Flibrary');
  assert.equal(f.observers[0].disconnected,true);assert.equal(f.host.children.length,1);
  f.view.unmount();
});

test('missing or failed Google SDK retains visible email recovery guidance',async()=>{
  for(const options of [{available:false},{renderThrows:true}]){
    const f=fixture(options);await f.ready();
    const alert=find(f.view.tree,n=>n.props?.role==='alert');assert.ok(alert);
    assert.match(textOf(alert),/Use email below/);f.view.unmount();
  }
});

test('script failure shows recovery guidance without trying to initialize Google',async()=>{
  const f=fixture();f.script().props.onError();await f.view.flush();
  assert.match(textOf(find(f.view.tree,n=>n.props?.role==='alert')),/Use email below/);
  assert.equal(f.initializations.length,0);f.view.unmount();
});

test('browser without ResizeObserver still adapts to window resize and removes its listener',async()=>{
  const f=fixture({observer:false});await f.ready();await f.resize(238);
  assert.ok(f.host.children[0].frameWidth<=238);
  const count=f.calls.length;f.view.unmount();f.env.window.dispatchEvent(new Event('resize'));
  assert.equal(f.calls.length,count);
});
