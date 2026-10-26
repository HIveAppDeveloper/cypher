type AgentKind = 'research' | 'review' | 'build' | 'write' | 'plan' | 'data' | 'design' | 'security' | 'finance' | 'support' | 'runner' | 'general';

const kinds: AgentKind[] = ['research', 'review', 'build', 'write', 'plan', 'data', 'design', 'security', 'finance', 'support', 'runner', 'general'];

function roleKind(value: string): AgentKind | undefined {
  const text = value.toLowerCase();
  if (/research|search|scout|discover/.test(text)) return 'research';
  if (/review|critic|audit|quality|test/.test(text)) return 'review';
  if (/security|protect|trust|defen/.test(text)) return 'security';
  if (/engineer|develop|code|build|program/.test(text)) return 'build';
  if (/write|writer|draft|content|story|editor/.test(text)) return 'write';
  if (/plan|strategy|coordinate|coordinator|manage/.test(text)) return 'plan';
  if (/data|analyst|analysis|science/.test(text)) return 'data';
  if (/design|visual|creative|artist/.test(text)) return 'design';
  if (/finance|invest|account|budget/.test(text)) return 'finance';
  if (/support|service|help|customer/.test(text)) return 'support';
  if (/runner|execute|ship|operat/.test(text)) return 'runner';
  if (/general|assistant/.test(text)) return 'general';
  return undefined;
}

export function agentIdentity(name: string, role = '') {
  let signature = 2166136261;
  for (const character of name.trim().toLowerCase()) signature = Math.imul(signature ^ character.codePointAt(0)!, 16777619) >>> 0;
  return { kind: roleKind(role) || roleKind(name) || kinds[signature % kinds.length], signature };
}

function AgentGlyph({ kind, signature }: { kind: AgentKind; signature: number }) {
  let mark;
  if (kind === 'research') mark = <><circle cx="12" cy="12" r="6.5"/><path d="m14.8 9.2-1.6 4-4 1.6 1.6-4 4-1.6Z"/><path d="M12 3v2m0 14v2M3 12h2m14 0h2"/></>;
  else if (kind === 'review') mark = <><path d="M7 4.5h10l3 7.5-8 8-8-8L7 4.5Z"/><path d="m8.5 11.5 2.4 2.4 4.8-4.8"/></>;
  else if (kind === 'build') mark = <><path d="m8 6-5 6 5 6m8-12 5 6-5 6M14 4l-4 16"/></>;
  else if (kind === 'write') mark = <><path d="m6 17-1 3 3-1L19 8a2.1 2.1 0 0 0-3-3L5 16m9-9 3 3"/><path d="M5 5h5M5 9h2M13 20h6"/></>;
  else if (kind === 'plan') mark = <><circle cx="12" cy="12" r="3"/><path d="M12 3v4m0 10v4M3 12h4m10 0h4m-2.6-6.4-2.8 2.8m-7.2 7.2-2.8 2.8m0-12.8 2.8 2.8m7.2 7.2 2.8 2.8"/></>;
  else if (kind === 'data') mark = <><path d="M4 19h16M6 15v-4m6 4V5m6 10V8"/><circle cx="6" cy="8" r="1"/><circle cx="18" cy="5" r="1"/></>;
  else if (kind === 'design') mark = <><path d="m12 3 8 9-8 9-8-9 8-9Z"/><path d="m4 12 8-3 8 3m-8-3v12"/><circle cx="12" cy="9" r="1.1"/></>;
  else if (kind === 'security') mark = <><path d="M12 3 5 6v6c0 4 7 9 7 9s7-5 7-9V6l-7-3Z"/><path d="m8.5 11.8 2.3 2.3 4.7-4.7"/></>;
  else if (kind === 'finance') mark = <><path d="M6 4v16m6-16v16m6-16v16"/><path d="M4 8h4v6H4zm6-2h4v5h-4zm6 7h4v4h-4z"/></>;
  else if (kind === 'support') mark = <><path d="M5 17.5 3 21l5.5-2a8 8 0 1 0-3.5-1.5Z"/><path d="M8 11h8m-8 4h5"/></>;
  else if (kind === 'runner') mark = <><path d="m14 3-9 11h6l-1 7 9-11h-6l1-7Z"/></>;
  else mark = <><path d="m12 3 8 5v8l-8 5-8-5V8l8-5Zm-8 5 8 5 8-5m-8 5v8"/></>;
  return <svg className="agent-emblem-art" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{mark}<g className="agent-emblem-signature" transform={`rotate(${(signature % 4) * 90} 12 12)`}><path d="M3 6V3h3"/><circle cx={17 + ((signature >>> 3) % 3)} cy="21" r=".65" fill="currentColor" stroke="none"/></g></svg>;
}

export function BotAvatar({ name, small = false, agentRole, status }: { name: string; small?: boolean; agentRole?: string; status?: string }) {
  const { kind, signature } = agentIdentity(name, agentRole);
  return <span className={`bot-avatar agent-initials agent-glyph agent-emblem ${small ? 'small-avatar' : ''}`} data-agent-kind={kind} data-agent-signature={signature.toString(16)} data-agent-status={status} aria-hidden="true"><AgentGlyph kind={kind} signature={signature}/></span>;
}
