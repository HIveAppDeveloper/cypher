function avatarKind(value: string) {
  const text = value.toLowerCase();
  if (/research|search|scout|discover/.test(text)) return 'research';
  if (/review|critic|audit|quality/.test(text)) return 'review';
  if (/runner|run|execute|build|ship/.test(text)) return 'runner';
  if (/write|draft|content|story/.test(text)) return 'write';
  if (/plan|strategy|coordinate|manage/.test(text)) return 'plan';
  return 'default';
}

function AgentGlyph({ kind }: { kind: string }) {
  if (kind === 'research') return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.25"/><path d="m15.2 15.2 4.3 4.3M8 10.5h5"/></svg>;
  if (kind === 'review') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5.5 12.5 4.2 4.1 8.8-9"/><path d="M20 12a8 8 0 1 1-4-6.9"/></svg>;
  if (kind === 'runner') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10-6.5-10-6.5Z"/><path d="M4 8v8"/></svg>;
  if (kind === 'write') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 16.5-.8 3.3 3.3-.8L18.8 7.7a2.3 2.3 0 0 0-3.3-3.3L5 14.9v1.6Z"/><path d="m13.8 6.1 4.1 4.1"/></svg>;
  if (kind === 'plan') return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="6" r="2"/><circle cx="18" cy="8" r="2"/><circle cx="8" cy="18" r="2"/><path d="m8 7 7.8 1m-8.7 7.9L6.5 8m3.2 8.4 6.6-7"/></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="7" cy="7" r="1.1"/><circle cx="12" cy="7" r="1.1"/><circle cx="17" cy="7" r="1.1"/><circle cx="7" cy="12" r="1.1"/><circle cx="12" cy="12" r="1.1"/><circle cx="17" cy="12" r="1.1"/><circle cx="7" cy="17" r="1.1"/><circle cx="12" cy="17" r="1.1"/><circle cx="17" cy="17" r="1.1"/></svg>;
}

export function BotAvatar({ name, small = false, agentRole, status }: { name: string; small?: boolean; agentRole?: string; status?: string }) {
  const tones = ['#e9e6e0', '#e1e9e5', '#e3e7ee', '#eae3e7'];
  const tone = tones[Array.from(name).reduce((sum, character) => sum + character.charCodeAt(0), 0) % tones.length];
  const initials = name.split(/\s+/).filter(Boolean).slice(0,2).map(word=>word[0]).join('').toUpperCase();
  const kind = avatarKind([name, agentRole || ''].join(' '));
  return <span className={`bot-avatar agent-initials ${agentRole ? 'agent-glyph' : ''} ${small ? 'small-avatar' : ''}`} data-agent-kind={agentRole ? kind : undefined} data-agent-status={status} style={{backgroundColor:tone}} aria-hidden="true">{agentRole ? <AgentGlyph kind={kind}/> : initials}</span>;
}
