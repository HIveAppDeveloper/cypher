import { api } from './api';
const decode=(value:string)=>Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-value.length%4)%4)),c=>c.charCodeAt(0));
const encode=(value:ArrayBuffer)=>btoa(String.fromCharCode(...Array.from(new Uint8Array(value)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
function serialize(credential:PublicKeyCredential){const response=credential.response as AuthenticatorAttestationResponse & AuthenticatorAssertionResponse;return {id:credential.id,rawId:encode(credential.rawId),type:credential.type,response:{clientDataJSON:encode(response.clientDataJSON),...(response.attestationObject?{attestationObject:encode(response.attestationObject)}:{authenticatorData:encode(response.authenticatorData),signature:encode(response.signature),userHandle:response.userHandle?encode(response.userHandle):null})},clientExtensionResults:credential.getClientExtensionResults()};}
async function ceremony(purpose:string){
 if(!window.PublicKeyCredential||!navigator.credentials)throw new Error('This browser does not support passkeys. Use a current Safari, Chrome, or Edge browser.');
 const state=await api.deviceStatus();if(window.location.origin!==state.origin)throw new Error('Use '+state.origin+' for device approval. Passkeys are bound to that address.');
 const request=await api.deviceChallenge(purpose);const options=request.options;
 options.challenge=decode(options.challenge);
 let credential:PublicKeyCredential|null;
 try{if(purpose==='register'){options.user.id=decode(options.user.id);credential=await navigator.credentials.create({publicKey:options}) as PublicKeyCredential|null;}else{options.allowCredentials=options.allowCredentials?.map((item:{id:string;type:string})=>({...item,id:decode(item.id)}));credential=await navigator.credentials.get({publicKey:options}) as PublicKeyCredential|null;}}catch{throw new Error('Device approval was cancelled or unavailable. No connection was added.');}
 if(!credential)throw new Error('No device credential was returned.');
 return api.deviceVerify(request.challenge_id,serialize(credential));
}
export const enrollDevice=()=>ceremony('register');
export async function approveConnection(action:string){const status=await api.deviceStatus();if(!status.enrolled)return undefined;return (await ceremony(action)).approval_id as string;}
