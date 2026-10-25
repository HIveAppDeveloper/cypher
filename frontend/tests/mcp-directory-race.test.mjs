import {test} from 'node:test';
import assert from 'node:assert/strict';
import {environment,renderer,load,deferred,find,textOf,button,field} from './support/component-harness.mjs';

function entry(id, name = id) {
  return {id,registry_name:'fixture',version:'1.0.0',name,url:`https://${id}.example/mcp`,description:`${name} description`,category:'Design',icon:null,domains:[`${id}.example`],source:'https://registry.example/',transport:'streamable-http',setup_note:'',test_status:'not_tested',test_message:'',tool_count:null,auth:'none'};
}

function page(items, {total = items.length, categories = ['Design', 'Engineering']} = {}) {
  return {items,categories,offset:0,limit:24,total,count:total,fetched_at:null};
}

function directory(getMcpDirectory) {
  const env=environment(),view=renderer(env);
  const {McpDirectory}=load('../src/components/McpDirectory.tsx',{
    react:view.react,
    './LoadingState':{LoadingState:'loading-state'},
    '../lib/api':{api:{getMcpDirectory}},
  },{...env.globals,React:view.react.default});
  view.mount(()=>McpDirectory({busy:false,connectedUrls:[],onConnect(){}}));
  return {env,view};
}

async function settle(view, pending, result) {
  pending.resolve(result);
  await view.flush();
}

test('a query change invalidates the first page before the replacement debounce fires',async()=>{
  const first=deferred(),filtered=deferred(),calls=[];
  const {env,view}=directory(input=>{calls.push(input);return calls.length===1?first.promise:filtered.promise;});
  env.time.advance(180);await view.flush();
  assert.equal(calls[0].q,'');

  field(view.tree,'mcp-directory-search').props.onChange({target:{value:'alpha'}});
  await settle(view,first,page([entry('stale-original','Stale original result')]));
  assert.doesNotMatch(textOf(view.tree),/Stale original result/);
  assert.equal(calls.length,1,'the replacement request remains debounced');

  env.time.advance(180);await view.flush();
  assert.equal(calls[1].q,'alpha');
  await settle(view,filtered,page([entry('alpha','Alpha service')]));
  assert.match(textOf(view.tree),/Alpha service/);
  assert.doesNotMatch(textOf(view.tree),/Stale original result/);
  view.unmount();
});

for (const scenario of [
  {name:'search',change:tree=>field(tree,'mcp-directory-search').props.onChange({target:{value:'alpha'}}),query:'alpha',stale:'Late old search page'},
  {name:'category',change:tree=>field(tree,'mcp-directory-category').props.onChange({target:{value:'Engineering'}}),category:'Engineering',stale:'Late old category page'},
  {name:'kind',change:tree=>field(tree,'mcp-directory-kind').props.onChange({target:{value:'verified'}}),kind:'verified',stale:'Late old kind page'},
]) {
  test(`a late load-more response cannot overwrite a ${scenario.name} change`,async()=>{
    const more=deferred(),filtered=deferred(),calls=[];
    const firstPage=page(Array.from({length:24},(_,index)=>entry(`base-${index}`)),{total:48});
    const {env,view}=directory(input=>{calls.push(input);if(calls.length===1)return Promise.resolve(firstPage);if(calls.length===2)return more.promise;return filtered.promise;});
    env.time.advance(180);await view.flush();
    assert.equal(find(view.tree,node=>node.type==='article'&&textOf(node).includes('base-0'))!==undefined,true);

    button(view.tree,'Show more (24 left)').props.onClick();
    await view.flush();
    assert.equal(calls.length,2);
    scenario.change(view.tree);
    await settle(view,more,page([entry(`stale-${scenario.name}`,scenario.stale)],{total:49}));
    assert.doesNotMatch(textOf(view.tree),new RegExp(scenario.stale));
    assert.doesNotMatch(textOf(view.tree),/Late stale page failure/);
    assert.equal(find(view.tree,node=>node.type==='button'&&textOf(node).startsWith('Show more')),undefined);

    env.time.advance(180);await view.flush();
    assert.equal(calls.length,3);
    assert.equal(calls[2].q,scenario.query ?? '');
    assert.equal(calls[2].category,scenario.category ?? '');
    assert.equal(calls[2].kind,scenario.kind ?? 'all');
    await settle(view,filtered,page([entry(`fresh-${scenario.name}`,`Fresh ${scenario.name} result`)]));
    assert.match(textOf(view.tree),new RegExp(`Fresh ${scenario.name} result`));
    assert.doesNotMatch(textOf(view.tree),new RegExp(scenario.stale));
    view.unmount();
  });
}

test('directory retry reissues the current first page and clears the recoverable error',async()=>{
  const retried=deferred();let calls=0;
  const {env,view}=directory(()=>++calls===1?Promise.reject(Error('Synthetic directory failure')):retried.promise);
  env.time.advance(180);await view.flush();
  assert.match(textOf(view.tree),/Synthetic directory failure/);
  button(view.tree,'Retry').props.onClick();
  await view.flush();
  assert.doesNotMatch(textOf(view.tree),/Synthetic directory failure/);
  env.time.advance(180);await view.flush();
  assert.equal(calls,2);
  await settle(view,retried,page([entry('recovered','Recovered service')]));
  assert.match(textOf(view.tree),/Recovered service/);
  view.unmount();
});

test('a stale load-more failure after a filter change does not surface as the new filter error',async()=>{
  const more=deferred(),filtered=deferred();let calls=0;
  const firstPage=page(Array.from({length:24},(_,index)=>entry(`failure-base-${index}`)),{total:48});
  const {env,view}=directory(()=>++calls===1?Promise.resolve(firstPage):calls===2?more.promise:filtered.promise);
  env.time.advance(180);await view.flush();
  button(view.tree,'Show more (24 left)').props.onClick();await view.flush();
  field(view.tree,'mcp-directory-kind').props.onChange({target:{value:'auth'}});
  more.reject(Error('Late stale page failure'));await view.flush();
  assert.doesNotMatch(textOf(view.tree),/Late stale page failure/);
  env.time.advance(180);await view.flush();
  assert.equal(calls,3);
  await settle(view,filtered,page([entry('filtered-auth','Filtered auth service')]));
  assert.match(textOf(view.tree),/Filtered auth service/);
  assert.doesNotMatch(textOf(view.tree),/Late stale page failure/);
  view.unmount();
});
