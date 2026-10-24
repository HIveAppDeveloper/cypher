export function BotAvatar({ name, small = false }: { name: string; small?: boolean }) {
  const tones = ['#e9e6e0', '#e1e9e5', '#e3e7ee', '#eae3e7'];
  const tone = tones[Array.from(name).reduce((sum, character) => sum + character.charCodeAt(0), 0) % tones.length];
  const initials = name.split(/\s+/).filter(Boolean).slice(0,2).map(word=>word[0]).join('').toUpperCase();
  return <span className={`bot-avatar agent-initials ${small ? 'small-avatar' : ''}`} style={{backgroundColor:tone}} aria-hidden="true">{initials}</span>;
}
