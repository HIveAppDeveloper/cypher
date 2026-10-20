export function BotAvatar({ name, small = false }: { name: string; small?: boolean }) {
  const colors = ['#f52d98', '#ff2845', '#151515', '#13b6a9', '#9653f5', '#a7733d', '#ff751f'];
  const color = colors[Array.from(name).reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % colors.length];
  return <svg className={small ? 'bot-avatar small-avatar' : 'bot-avatar'} viewBox="0 0 48 48" aria-hidden="true"><path fill={color} d="M8 11C11 5 22 3 29 5c8-1 15 10 15 20 2 7-7 16-14 16-7 5-13 0-18 1C3 40 1 28 4 23c-1-4 0-9 4-12Z" /><path d="m23 15 3 7m7-11 3 7" fill="none" stroke="white" strokeWidth="4" strokeLinecap="round" /></svg>;
}
