import {test} from 'node:test';
import assert from 'node:assert/strict';
import {environment,renderer,load,find,textOf,button,deferred} from './support/component-harness.mjs';

const proposalId='123e4567-e89b-42d3-a456-426614174000';
const account={id:'gmail-grant',provider:'gmail',sender:'investor@example.test',available:true};
const baseProposal={
  id:proposalId,provider:'gmail',account_id:account.id,sender:account.sender,
  recipient:'founder@example.test',subject:'A question about your company',
  body:'Hello Founder, I would like to learn more about your work.',digest:'a'.repeat(64),
  status:'awaiting_approval',review_expires_at:'2099-01-01T00:00:00Z',approved_at:null,
  approved_by:null,not_before:null,attempted_at:null,completed_at:null,gmail_draft_id:null,
  detail:null,review_token:'review-token-from-api',server_time:'2026-01-01T00:00:00Z',
  review_expired:false,recipient_policy:{held:false,suppressed:false},review_eligible:true,
  creation_eligible:true,review_blocker:null,
};

function logic(){
  return {
    canCancelProposal:()=>false,
    canCreateDraftProposal:row=>row.status==='awaiting_approval'&&row.creation_eligible,
    canReviewProposal:()=>false,
    outreachStatus:row=>({label:row.status==='draft_created'?'Gmail draft saved':'Ready to review',message:'Check the recipient and message.'}),
    outreachTime:value=>Date.parse(value||''),
    proposalIdIsValid:id=>/^[\da-f-]{36}$/i.test(id),
  };
}

function mountReview({request,proposal=baseProposal,accountId='account-a',initialProposalId=proposalId,initialSourceRunId='',initialSourceResultId=''}){
  const env=environment(),view=renderer(env);
  class ApiError extends Error { constructor(message,status){super(message);this.status=status;} }
  const {default:Review}=load('../src/components/SourcingOutreachReview.tsx',{
    react:view.react,
    '../lib/api':{ApiError,request},
    '../lib/sourcing-outreach':logic(),
    './sourcing-outreach-review.css':{},
  },{...env.globals,React:view.react.default,URLSearchParams,crypto:{randomUUID:()=> 'request-fixture'}});
  let props={accountId,initialProposalId,initialSourceRunId,initialSourceResultId};
  view.mount(()=>Review(props));
  return {view,env,setProps(next){props={...props,...next};view.rerender();}};
}

test('the outreach page remounts private review state when the signed-in account changes',async()=>{
  let session={sub:'account-a'};
  const env=environment(),view=renderer(env);
  const {default:Page}=load('../src/app/sourcing/outreach/page.tsx',{
    'next/headers':{cookies:async()=>({get:()=>({value:'synthetic-session'})})},
    'next/navigation':{redirect:()=>{throw Error('Unexpected redirect');}},
    '../../../lib/auth-server':{readSignedPayload:()=>session},
    '../../../components/SourcingOutreachReview':{__esModule:true,default:'outreach-review'},
    '../../../components/WorkflowShell':{__esModule:true,default:'workflow-shell'},
  },{...env.globals,React:view.react.default,process:{env:{REQUIRE_USER_AUTH:'true'}}});
  const props={searchParams:Promise.resolve({proposal:proposalId})};
  const first=find(await Page(props),node=>node.type==='outreach-review');
  session={sub:'account-b'};
  const second=find(await Page(props),node=>node.type==='outreach-review');
  assert.ok(first&&second);
  assert.equal(first.props.accountId,'account-a');
  assert.equal(second.props.accountId,'account-b');
  assert.notEqual(first.props.key,second.props.key,'the same proposal URL must remount when the signed-in account changes');
});

test('account changes clear confirmation and ignore a late prior-account draft response',async()=>{
  const lateDraftA=deferred(),accountsB=deferred(),proposalB=deferred();
  const accountA={id:'gmail-a',provider:'gmail',sender:'account-a@example.test',available:true};
  const accountB={id:'gmail-b',provider:'gmail',sender:'account-b@example.test',available:true};
  const proposalForB={...baseProposal,account_id:accountB.id,sender:accountB.sender,recipient:'founder-b@example.test',subject:'PRIVATE-B-SUBJECT',body:'PRIVATE-B-BODY',review_token:'review-token-b'};
  const calls=[];
  let currentAccount='account-a';
  const request=async(path,options={})=>{
    calls.push({account:currentAccount,path,options});
    if(path==='/sourcing/outreach/accounts')return currentAccount==='account-a'?{accounts:[accountA]}:accountsB.promise;
    if(path===`/sourcing/outreach/${proposalId}`)return currentAccount==='account-a'?baseProposal:proposalB.promise;
    if(path===`/sourcing/outreach/${proposalId}/create-draft`)return lateDraftA.promise;
    throw new Error(`Unexpected request: ${path}`);
  };
  const {view,setProps}=mountReview({request,accountId:'account-a'});
  await view.flush();
  const confirmation=find(view.tree,node=>node.type==='input'&&node.props?.type==='checkbox');
  assert.ok(confirmation);
  confirmation.props.onChange({target:{checked:true}});
  await view.flush();
  assert.equal(find(view.tree,node=>node.type==='input'&&node.props?.type==='checkbox').props.checked,true);
  button(view.tree,'Confirm and create Gmail draft').props.onClick();
  await view.flush();
  assert.ok(calls.some(call=>call.account==='account-a'&&call.path.endsWith('/create-draft')),'account A draft mutation is pending');

  currentAccount='account-b';
  setProps({accountId:'account-b'});
  await view.flush();
  const privateA=['investor@example.test','founder@example.test','A question about your company','Hello Founder, I would like to learn more about your work.'];
  for(const value of privateA)assert.equal(textOf(view.tree).includes(value),false,'account A data is cleared while B loads');
  assert.equal(find(view.tree,node=>node.type==='input'&&node.props?.type==='checkbox'),undefined,'A’s confirmation is cleared');
  assert.match(textOf(view.tree),/Switching accounts|Loading your outreach workspace/);

  lateDraftA.resolve({...baseProposal,status:'draft_created',review_token:undefined,gmail_draft_id:'late-account-a-draft'});
  await view.flush();
  for(const value of privateA)assert.equal(textOf(view.tree).includes(value),false,'a late A response cannot repopulate B’s page');
  assert.match(textOf(view.tree),/Loading your outreach workspace/);

  accountsB.resolve({accounts:[accountB]});
  proposalB.resolve(proposalForB);
  await view.flush();
  assert.match(textOf(view.tree),/account-b@example\.test/);
  assert.match(textOf(view.tree),/PRIVATE-B-SUBJECT/);
  assert.match(textOf(view.tree),/PRIVATE-B-BODY/);
  assert.doesNotMatch(textOf(view.tree),/investor@example\.test|A question about your company|Hello Founder/);
  const confirmationB=find(view.tree,node=>node.type==='input'&&node.props?.type==='checkbox');
  assert.ok(confirmationB);
  assert.equal(confirmationB.props.checked,false,'account B must explicitly confirm its own email');
  assert.equal(button(view.tree,'Confirm and create Gmail draft').props.disabled,true);
  view.unmount();
});

test('explicitly confirms the reviewed Gmail account and recipient before creating a draft',async()=>{
  const calls=[];
  const request=async(path,options={})=>{
    calls.push({path,options});
    if(path==='/sourcing/outreach/accounts')return {accounts:[account]};
    if(path===`/sourcing/outreach/${proposalId}`)return baseProposal;
    if(path===`/sourcing/outreach/${proposalId}/create-draft`){
      return {...baseProposal,status:'draft_created',review_token:undefined,gmail_draft_id:'synthetic-draft',attempted_at:'2026-01-01T00:00:00Z'};
    }
    throw new Error(`Unexpected request: ${path}`);
  };
  const {view}=mountReview({request});
  await view.flush();

  assert.match(textOf(view.tree),/I want to save this email as a Gmail draft from investor@example\.test to founder@example\.test\./);
  assert.match(textOf(view.tree),/It will not send the email\./);
  const checkbox=find(view.tree,node=>node.type==='input'&&node.props?.type==='checkbox');
  const confirm=button(view.tree,'Confirm and create Gmail draft');
  assert.ok(checkbox);
  assert.equal(confirm.props.disabled,true,'explicit confirmation starts unchecked');
  assert.deepEqual(calls.filter(call=>call.options.method==='POST'),[],'opening review does not mutate or contact Gmail');

  checkbox.props.onChange({target:{checked:true}});
  await view.flush();
  assert.equal(button(view.tree,'Confirm and create Gmail draft').props.disabled,false);
  button(view.tree,'Confirm and create Gmail draft').props.onClick();
  await view.flush();

  const mutations=calls.filter(call=>call.options.method==='POST');
  assert.equal(mutations.length,1);
  assert.equal(mutations[0].path,`/sourcing/outreach/${proposalId}/create-draft`);
  assert.deepEqual(JSON.parse(mutations[0].options.body),{
    digest:baseProposal.digest,
    review_token:baseProposal.review_token,
    confirmation:'create_gmail_draft_exact_message_and_account',
  });
  assert.equal(calls.some(call=>/\/send(?:\?|$)/.test(call.path)),false,'the UI has no send action');
  assert.match(textOf(view.tree),/Gmail draft saved/);
  view.unmount();
});

test('SEC match prefill leaves the unverified recipient blank until the user supplies it',async()=>{
  const calls=[];
  const request=async(path,options={})=>{
    calls.push({path,options});
    if(path==='/sourcing/outreach/accounts')return {accounts:[account]};
    if(path.startsWith('/prospecting/investors/runs/'))return {subject:'Research-based subject',body:'Research-based message'};
    throw new Error(`Unexpected request: ${path}`);
  };
  const {view}=mountReview({request,initialProposalId:'',initialSourceRunId:proposalId,initialSourceResultId:'sec-result-1'});
  await view.flush();
  const recipient=find(view.tree,node=>node.props?.id==='outreach-recipient');
  const subject=find(view.tree,node=>node.props?.id==='outreach-subject');
  assert.equal(recipient.props.value,'');
  assert.equal(recipient.props.required,true);
  assert.equal(subject.props.value,'Research-based subject');
  assert.equal(button(view.tree,'Prepare for review').props.disabled,true,'a user must supply the recipient before a proposal is created');
  assert.deepEqual(calls.filter(call=>call.options.method==='POST').map(call=>call.path),[
    `/prospecting/investors/runs/${proposalId}/results/sec-result-1/outreach`,
  ]);
  view.unmount();
});
