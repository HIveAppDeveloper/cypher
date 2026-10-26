import {test} from 'node:test';
import assert from 'node:assert/strict';
import {environment,renderer,load,find,textOf,button,deferred} from './support/component-harness.mjs';

const profile=(bot_id,selected_by='agent')=>({bot_id,selected_by,skills:Array.from({length:5},(_,i)=>({id:'skill-'+i,name:'Working skill '+i,specialty:'Synthetic specialty'}))});
function mount(request){
 const env=environment(),view=renderer(env);let botId='bot-a';
 const {AgentSkills}=load('../src/components/WorkspaceHub.tsx',{react:view.react,'../lib/api':{api:{},request},'./GlassSelect':{GlassSelect:'select'},'./LoadingState':{LoadingState:'loading-state'}},{...env.globals,React:view.react.default});
 view.mount(()=>AgentSkills({botId}));
 return {view,changeBot(id){botId=id;view.rerender();}};
}
const open=view=>find(view.tree,node=>node.type==='details').props.onToggle({currentTarget:{open:true}});

test('skills load lazily and distinguish suggestions from a real agent choice',async()=>{
 const calls=[];const {view}=mount(async path=>{calls.push(path);return profile('bot-a','automatic');});
 assert.equal(calls.length,0,'a 200-agent list must not fetch every profile before the owner opens it');
 open(view);await view.flush();
 assert.deepEqual(calls,['/bots/bot-a/skills']);
 assert.match(textOf(view.tree),/Suggested from this agent’s instructions/);
 assert.doesNotMatch(textOf(view.tree),/Chosen by this agent/);
 for(let i=0;i<5;i++)assert.match(textOf(view.tree),new RegExp('Working skill '+i));
 open(view);await view.flush();assert.equal(calls.length,1);
 view.unmount();
});

test('failed skill reads can retry without claiming an agent selection',async()=>{
 let attempts=0;const {view}=mount(async()=>{if(++attempts===1)throw Error('Connection interrupted');return profile('bot-a');});
 open(view);await view.flush();
 assert.match(textOf(view.tree),/Connection interrupted/);
 assert.doesNotMatch(textOf(view.tree),/Chosen by this agent/);
 button(view.tree,'Retry skills').props.onClick();await view.flush();
 assert.equal(attempts,2);
 assert.equal(find(view.tree,node=>node.props?.role==='alert'),undefined);
 assert.match(textOf(view.tree),/Chosen by this agent/);
 view.unmount();
});

test('old profiles cannot appear after switching agents or unmounting',async()=>{
 const old=deferred(),late=deferred();
 const app=mount(path=>path.includes('bot-a')?old.promise:late.promise),{view}=app;
 open(view);await view.flush();app.changeBot('bot-b');open(view);await view.flush();
 old.resolve(profile('bot-a'));await view.flush();
 assert.doesNotMatch(textOf(view.tree),/Working skill|Chosen by this agent/);
 view.unmount();late.resolve(profile('bot-b'));await view.flush();
 assert.equal(view.updatesAfterUnmount,0);
});

test('invalid or cross-agent five-skill profiles stay unavailable',async()=>{
 for(const result of [profile('another-bot'),{...profile('bot-a'),skills:Array(5).fill(profile('bot-a').skills[0])},{...profile('bot-a'),skills:[]}]){
  const {view}=mount(async()=>result);open(view);await view.flush();
  assert.ok(button(view.tree,'Retry skills'));
  assert.doesNotMatch(textOf(view.tree),/Chosen by this agent/);
  view.unmount();
 }
});

const source=()=>({repository:'example/reviewed-skills',commit:'a'.repeat(40),path:'skills/review/SKILL.md',url:'https://github.com/example/reviewed-skills/blob/'+ 'a'.repeat(40)+'/skills/review/SKILL.md',stars:164173,checked_at:'2026-10-26T15:00:00Z',license:'MIT',adaptation_scope:'workflow_adaptation'});

test('eligible skill sources link to pinned GitHub files and label dated star evidence',async()=>{
 const result=profile('bot-a');
 for(const skill of result.skills){skill.eligibility={eligible:true,minimum_stars:10000};skill.sources=[source()];}
 const {view}=mount(async()=>result);open(view);await view.flush();
 const link=find(view.tree,node=>node.type==='a');
 assert.equal(link.props.href,source().url);
 assert.equal(link.props.target,'_blank');
 assert.equal(link.props.rel,'noopener noreferrer');
 assert.equal(link.props.title,'skills/review/SKILL.md');
 assert.match(textOf(view.tree),/GitHub sources/);
 assert.match(textOf(view.tree),/164.?173 stars/);
 assert.equal(find(view.tree,node=>node.type==='time').props.dateTime,source().checked_at);
 view.unmount();
});

test('ineligible or mismatched source metadata cannot appear as verified GitHub evidence',async()=>{
 for(const invalid of [{...source(),url:'https://github.com.evil.example/repo'},{...source(),stars:9999},{...source(),commit:'not-pinned'},{...source(),license:'unknown'}]){
  const result=profile('bot-a');
  for(const skill of result.skills){skill.eligibility={eligible:true,minimum_stars:10000};skill.sources=[invalid];}
  const {view}=mount(async()=>result);open(view);await view.flush();
  assert.equal(find(view.tree,node=>node.type==='a'),undefined);
  assert.doesNotMatch(textOf(view.tree),/GitHub sources|stars/);
  view.unmount();
 }
});

test('expired or unavailable source catalog keeps the primary-agent fallback truthful',async()=>{
 const {view}=mount(async()=>({bot_id:'bot-a',selected_by:'automatic',availability:'primary_agent_fallback',selection_count:0,required_selection_count:5,skills:[]}));
 open(view);await view.flush();
 assert.match(textOf(view.tree),/Skill guides are temporarily unavailable/);
 assert.match(textOf(view.tree),/agent can continue with its own instructions and enabled tools/);
 assert.doesNotMatch(textOf(view.tree),/Chosen by this agent|Suggested from|Five working skills/);
 assert.equal(button(view.tree,'Retry skills'),undefined,'a source-eligibility fallback is not a failed request');
 assert.equal(find(view.tree,node=>node.props?.role==='alert'),undefined);
 view.unmount();
});
