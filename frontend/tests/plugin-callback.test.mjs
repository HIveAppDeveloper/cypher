import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {load} from './support/component-harness.mjs';
const require=createRequire(import.meta.url),next=require('next/server');
const origin='https://app.example',id='e52dad3f-b0db-4cf8-a0f0-f9b88c16f230';
const helper=load('../src/lib/pluginAuthorization.ts',{}, {URL,Date});
const env={BACKEND_INTERNAL_URL:'http://backend.fixture',GROKBOT_BACKEND_API_TOKEN:'synthetic-service-token'};
function route(file,fetch){return load(file,{'next/server':next,'../../../lib/auth-server':{getSessionFromCookieHeader:()=>null},'../../../../lib/auth-server':{getSessionFromCookieHeader:()=>null},'../../../lib/pluginAuthorization':helper,'../../../../lib/pluginAuthorization':helper},{URL,AbortSignal,process:{env},fetch});}
const callback='../src/app/api/plugin-oauth/callback/route.ts';
function req(query,returnTo='/?workspace=1&conversation=123',binding=true){return new next.NextRequest(origin+'/api/plugin-oauth/callback?'+query,{headers:{cookie:(binding?'grokbot-oauth-'+id+'=browser-binding; ':'')+'grokbot-oauth-return-'+id+'='+encodeURIComponent(returnTo)}});}
test('authorization proxy keeps the browser binding private and saves a same-origin return',async()=>{
  const proxy=route('../src/app/api/[...path]/route.ts',async()=>Response.json({status:'awaiting_login',flow_id:id,name:'Fixture',binding:'browser-binding',authorization_url:'https://provider.example/allow'}));
  const request=new next.NextRequest(origin+'/api/plugins/authorize',{method:'POST',body:'{}',headers:{referer:origin+'/?workspace=1&conversation=123'}});
  const response=await proxy.POST(request,{params:Promise.resolve({path:['plugins','authorize']})});
  assert.equal((await response.json()).binding,undefined);assert.equal(response.cookies.get('grokbot-oauth-'+id).value,'browser-binding');assert.equal(response.cookies.get('grokbot-oauth-return-'+id).value,'/?workspace=1&conversation=123');assert.match(response.headers.get('set-cookie'),/HttpOnly/);
});
test('a successful Allow returns to the original conversation without provider codes',async()=>{
  let body;const handler=route(callback,async(_,options)=>{body=JSON.parse(options.body);return Response.json({status:'connected'});});
  const response=await handler.GET(req('state='+id+'.synthetic-state&code=private-code'));
  const target=new URL(response.headers.get('location'));assert.equal(response.status,303);assert.equal(target.origin,origin);assert.equal(target.searchParams.get('conversation'),'123');assert.equal(target.searchParams.get('plugins'),'connected');assert.equal(target.searchParams.get('plugin_flow'),id);assert.equal(target.searchParams.has('code'),false);assert.equal(target.searchParams.has('state'),false);assert.equal(body.binding,'browser-binding');assert.equal(response.cookies.get('grokbot-oauth-return-'+id).value,'');
});
test('managed and direct provider denials both return cancelled, without connecting',async()=>{
  for(const managed of [false,true]){let path,body;const handler=route(callback,async(url,options)=>{path=new URL(url).pathname;body=JSON.parse(options.body);return Response.json({status:'cancelled'});});const response=await handler.GET(req('state='+id+'.synthetic-state&error=access_denied'+(managed?'&managed=1':'')));assert.equal(new URL(response.headers.get('location')).searchParams.get('plugins'),'cancelled');assert.equal(path,managed?'/api/plugins/oauth/cancel':'/api/plugins/oauth/callback');assert.equal(managed?body.flow_id===id:body.denied,true);}
});
test('missing browser binding never exchanges a code or marks a connection successful',async()=>{
  let calls=0;const handler=route(callback,async()=>{calls++;return Response.json({status:'connected'});});const response=await handler.GET(req('state='+id+'.synthetic-state&code=private-code','https://outside.example/',false));const target=new URL(response.headers.get('location'));assert.equal(calls,0);assert.equal(target.origin,origin);assert.equal(target.searchParams.get('plugins'),'failed');assert.equal(target.searchParams.has('code'),false);
});
test('backend failure preserves the conversation and returns a failure without leaking diagnostics',async()=>{
  const handler=route(callback,async()=>Response.json({detail:'private-code provider diagnostic'},{status:503}));const response=await handler.GET(req('state='+id+'.synthetic-state&code=private-code'));const target=new URL(response.headers.get('location'));assert.equal(target.searchParams.get('plugins'),'failed');assert.equal(target.searchParams.get('conversation'),'123');assert.ok(!target.href.includes('private-code'));
});
test('malformed state cannot create an invalid response cookie or call the backend',async()=>{
  const handler=route(callback,async()=>{throw Error('No backend call permitted');});const response=await handler.GET(new next.NextRequest(origin+'/api/plugin-oauth/callback?state=bad%3Bvalue'));assert.equal(response.status,303);assert.equal(response.headers.has('set-cookie'),false);
});
