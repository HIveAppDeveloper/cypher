// Configuration presence only. No credentials leave server-side callers.
export function loginReadiness({local,requireAuth,backendConfigured,backendTokenLength,sessionSecretLength}) {
  const configured=backendConfigured===true&&backendTokenLength>=32&&sessionSecretLength>=32;
  return {configured,preview:local===true&&requireAuth==='false'&&!configured};
}
export function previewDestination(returnTo) {
  return typeof returnTo==='string'&&returnTo.startsWith('/')&&!returnTo.startsWith('//')&&!returnTo.includes('\\')&&!/[\x00-\x1f\x7f]/.test(returnTo)&&!/^\/login(?:[/?#]|$)/.test(returnTo)?returnTo:'/gateway';
}
