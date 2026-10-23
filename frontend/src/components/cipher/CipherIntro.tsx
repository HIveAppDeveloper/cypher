'use client';
import { useEffect, useRef, useState } from 'react';

// Opening sequence: streams of binary fall, gather into the Cipher lens, the wordmark
// appears, then the overlay lifts. About 2.7 s; click or any key skips it.
const COLS = 41, ROWS = 17;
const FLOW_END = 900, GATHER_END = 1650, WORD_AT = 1500, LIFT_AT = 2350, DONE_AT = 2750;
const ease = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

export default function CipherIntro() {
  const [phase, setPhase] = useState<'play' | 'word' | 'lift' | 'gone'>('play');
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timers = reduce
      ? [setTimeout(() => setPhase('word'), 0), setTimeout(() => setPhase('lift'), 700), setTimeout(() => setPhase('gone'), 1000)]
      : [setTimeout(() => setPhase('word'), WORD_AT), setTimeout(() => setPhase('lift'), LIFT_AT), setTimeout(() => setPhase('gone'), DONE_AT)];
    const skip = () => { setPhase('lift'); timers.push(setTimeout(() => setPhase('gone'), 320)); };
    window.addEventListener('keydown', skip, { once: true });
    const canvas = canvasRef.current, ctx = canvas?.getContext('2d');
    let raf = 0;
    if (canvas && ctx && !reduce) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = window.innerWidth, h = window.innerHeight;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const ink = getComputedStyle(canvas).color || '#000';
      const lensW = Math.min(620, w * .86), lensH = lensW * 210 / 560, cx = w / 2, cy = h * .44;
      const cw = lensW / COLS, rh = lensH / ROWS, max = Math.min(cw * 1.05, rh * 1.25);
      type P = { x0: number; y0: number; speed: number; tx: number; ty: number; size: number; alpha: number; digit: string; delay: number; target: boolean };
      const parts: P[] = [];
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        const dx = (c + .5) / COLS * 2 - 1, dy = (r + .5) / ROWS * 2 - 1;
        const d = .55 * Math.hypot(dx, dy * 1.05) + .45 * (Math.abs(dx) * .92 + Math.abs(dy));
        const s = Math.max(0, 1 - d * 1.08); if (s <= .02) continue;
        const sz = Math.pow(s, .75);
        parts.push({ x0: Math.random() * w, y0: -Math.random() * h * 1.2, speed: .35 + Math.random() * .7, tx: cx - lensW / 2 + (c + .5) * cw, ty: cy - lensH / 2 + (r + .5) * rh, size: Math.max(1.4, max * sz), alpha: Math.min(1, .25 + sz * 1.1), digit: Math.random() < .5 ? '0' : '1', delay: Math.random() * 260 + Math.abs(dx) * 220, target: true });
      }
      const columns = Math.ceil(w / 22);
      for (let i = 0; i < columns * 5; i++) parts.push({ x0: (i % columns) * 22 + 11, y0: -Math.random() * h * 1.4, speed: .5 + Math.random() * .9, tx: 0, ty: 0, size: 11 + Math.random() * 4, alpha: .12 + Math.random() * .25, digit: Math.random() < .5 ? '0' : '1', delay: 0, target: false });
      const font = (size: number) => `${size.toFixed(1)}px -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', 'Inter Variable', sans-serif`;
      const start = performance.now();
      const draw = (now: number) => {
        const t = now - start;
        ctx.clearRect(0, 0, w, h); ctx.fillStyle = ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        for (const p of parts) {
          const fy = p.y0 + t * p.speed;
          if (!p.target) {
            const fade = 1 - ease((t - FLOW_END + 200) / 600);
            if (fade <= 0) continue;
            ctx.globalAlpha = p.alpha * fade; ctx.font = font(p.size);
            ctx.fillText(Math.random() < .03 ? (p.digit = p.digit === '0' ? '1' : '0') : p.digit, p.x0, fy % (h + 40));
            continue;
          }
          const k = ease((t - FLOW_END + 250 - p.delay) / (GATHER_END - FLOW_END));
          const x = p.x0 + (p.tx - p.x0) * k, y = (fy % (h + 40)) + (p.ty - (fy % (h + 40))) * k;
          const size = 12 + (p.size - 12) * k;
          ctx.globalAlpha = (.22 + (p.alpha - .22) * k);
          if (k < 1 && Math.random() < .04) p.digit = p.digit === '0' ? '1' : '0';
          if (size < 3) { ctx.beginPath(); ctx.arc(x, y, Math.max(.5, size * .35), 0, Math.PI * 2); ctx.fill(); }
          else { ctx.font = font(size); ctx.fillText(p.digit, x, y); }
        }
        ctx.globalAlpha = 1;
        if (t < DONE_AT) raf = requestAnimationFrame(draw);
      };
      raf = requestAnimationFrame(draw);
    }
    return () => { timers.forEach(clearTimeout); cancelAnimationFrame(raf); window.removeEventListener('keydown', skip); };
  }, []);

  if (phase === 'gone') return null;
  return (
    <div className={`cx-intro is-${phase}`} onClick={() => { setPhase('lift'); setTimeout(() => setPhase('gone'), 320); }} role="presentation">
      <canvas ref={canvasRef} aria-hidden="true" />
      <div className="cx-intro-word" aria-hidden={phase === 'play'}>
        <strong>Cipher</strong>
      </div>
    </div>
  );
}
