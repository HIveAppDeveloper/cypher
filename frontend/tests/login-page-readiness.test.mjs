import {test} from 'node:test';
import assert from 'node:assert/strict';
import {load,find,textOf} from './support/component-harness.mjs';
import * as readiness from '../src/lib/login-readiness.mjs';
const react={createElement:(type,props,...children)=>({type,props:{...props,children}})};
const canonical=load('../src/lib/canonical-app.ts',{}, {URL,URLSearchParams});
async function page({local=true,env={},session=null,returnTo}={}){
 const Page=load('../src/app/login/page.tsx',{
 'next/headers':{cookies:async()=>({get:()=>undefined}),headers:async()=>new Headers({host:local?'127.0.0.1:4320':'cypher-agent.vercel.app'})},
 'next/navigation':{redirect:url=>{throw new Error('Redirect '+url)}},
 '../../lib/auth-server':{readSignedPayload:()=>session},'../../lib/canonical-app':canonical,
 '../../components/GoogleLogin':{GoogleLogin:'google-login'},'../../components/EmailLoginForm':{EmailLoginForm:'email-login'},
 '../../components/cipher/CypherMark':{__esModule:true,default:'mark'},'../../components/cipher/CypherEntrance':{__esModule:true,default:'entrance'},
 '../../lib/login-readiness.mjs':readiness,
 './readiness.css':{},
 },{React:react,process:{env},URL,URLSearchParams}).default;
 return Page({searchParams:Promise.resolve({returnTo})});
}
test('local fixture sign-in page replaces unusable email form with explicit gateway continuation',async()=>{
 const tree=await page({env:{REQUIRE_USER_AUTH:'false'}});
 assert.match(textOf(tree),/Gateway preview/);assert.match(textOf(tree),/sample data/);
 assert.equal(find(tree,n=>n.type==='email-login'),undefined);assert.equal(find(tree,n=>n.type==='google-login'),undefined);
 assert.equal(find(tree,n=>n.type==='a'&&textOf(n).includes('Open gateway preview')).props.href,'/gateway');
});
test('public or auth-required configurations never offer an unauthenticated preview',async()=>{
 for(const config of [{local:false,env:{REQUIRE_USER_AUTH:'false'}},{local:true,env:{REQUIRE_USER_AUTH:'true'}}]){
 const tree=await page(config);assert.ok(!textOf(tree).includes('Open gateway preview'));assert.match(textOf(tree),/Sign-in is temporarily unavailable/);assert.equal(find(tree,n=>n.type==='email-login'),undefined);
 }
});
test('configured cloud login retains Google approval and email fallback',async()=>{
 const tree=await page({local:false,env:{REQUIRE_USER_AUTH:'true',BACKEND_INTERNAL_URL:'https://backend.invalid',GROKBOT_BACKEND_API_TOKEN:'synthetic-token-not-used'.padEnd(32,'x'),AUTH_SESSION_SECRET:'synthetic-session-not-used'.padEnd(32,'x'),GOOGLE_AUTH_CLIENT_ID:'synthetic-client'},returnTo:'/gateway'});
 assert.ok(find(tree,n=>n.type==='email-login'));const google=find(tree,n=>n.type==='google-login');assert.ok(google);assert.equal(google.props.loginUri,'https://cypher-agent.vercel.app/api/auth/google/callback?returnTo=%2Fgateway');
});
test('existing signed-in session still returns to the requested internal view',async()=>{
 await assert.rejects(page({session:{sub:'fixture'},returnTo:'/gateway'}),/Redirect \/gateway/);
});
