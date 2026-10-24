'use client';
import { useEffect, useRef, useState } from 'react';

// A brief binary-lens signature, shown once per tab without blocking the workspace.
const COLS = 41, ROWS = 17;
const FLOW_END = 300, GATHER_END = 760, LIFT_AT = 760, DONE_AT = 1180;
const ease = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
const SEEN_KEY = 'cypher-intro-seen-v3';

export default function CipherIntro() {
  const [phase, setPhase] = useState<'play' | 'lift' | 'gone'>('play');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dismissRef = useRef<() => void>(() => {});

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      || document.documentElement.dataset.motion === 'false';
    try {
      if (sessionStorage.getItem(SEEN_KEY) || reduced) { setPhase('gone'); return; }
      sessionStorage.setItem(SEEN_KEY, '1');
    } catch {
      if (reduced) { setPhase('gone'); return; }
    }

    const liftTimer = window.setTimeout(() => setPhase('lift'), LIFT_AT);
    const doneTimer = window.setTimeout(() => setPhase('gone'), DONE_AT);
    let done = false;
    let skipTimer = 0;
    const dismiss = () => {
      if (done) return;
      done = true;
      window.clearTimeout(liftTimer);
      window.clearTimeout(doneTimer);
      setPhase('lift');
      skipTimer = window.setTimeout(() => setPhase('gone'), 220);
    };
    dismissRef.current = dismiss;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') dismiss(); };
    window.addEventListener('keydown', onKeyDown);

    const canvas = canvasRef.current, ctx = canvas?.getContext('2d');
    let raf = 0;
    if (canvas && ctx) {
      const draw = () => {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = window.innerWidth, h = window.innerHeight;
        canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const ink = getComputedStyle(canvas).color || '#000';
        const lensW = Math.min(620, w * .86), lensH = lensW * 210 / 560, cx = w / 2, cy = h * .44;
        const cw = lensW / COLS, rh = lensH / ROWS, max = Math.min(cw * 1.05, rh * 1.25);
        type Particle = { x0: number; y0: number; speed: number; tx: number; ty: number; size: number; alpha: number; digit: string; delay: number; target: boolean };
        const parts: Particle[] = [];
        for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
          const dx = (c + .5) / COLS * 2 - 1, dy = (r + .5) / ROWS * 2 - 1;
          const d = .55 * Math.hypot(dx, dy * 1.05) + .45 * (Math.abs(dx) * .92 + Math.abs(dy));
          const s = Math.max(0, 1 - d * 1.08); if (s <= .02) continue;
          const sz = Math.pow(s, .75);
          parts.push({ x0: Math.random() * w, y0: -Math.random() * h * 1.2, speed: .35 + Math.random() * .7, tx: cx - lensW / 2 + (c + .5) * cw, ty: cy - lensH / 2 + (r + .5) * rh, size: Math.max(1.4, max * sz), alpha: Math.min(1, .25 + sz * 1.1), digit: Math.random() < .5 ? '0' : '1', delay: Math.random() * 170 + Math.abs(dx) * 160, target: true });
        }
        const columns = Math.ceil(w / 22);
        for (let i = 0; i < columns * 3; i++) parts.push({ x0: (i % columns) * 22 + 11, y0: -Math.random() * h * 1.4, speed: .5 + Math.random() * .9, tx: 0, ty: 0, size: 11 + Math.random() * 4, alpha: .12 + Math.random() * .25, digit: Math.random() < .5 ? '0' : '1', delay: 0, target: false });
        const font = (size: number) => `${size.toFixed(1)}px -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', 'Inter Variable', sans-serif`;
        const start = performance.now();
        const tick = (now: number) => {
          const t = now - start;
          ctx.clearRect(0, 0, w, h); ctx.fillStyle = ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          for (const p of parts) {
            const fy = p.y0 + t * p.speed;
            if (!p.target) {
              const fade = 1 - ease((t - FLOW_END + 90) / 360);
              if (fade <= 0) continue;
              ctx.globalAlpha = p.alpha * fade; ctx.font = font(p.size);
              ctx.fillText(Math.random() < .03 ? (p.digit = p.digit === '0' ? '1' : '0') : p.digit, p.x0, fy % (h + 40));
              continue;
            }
            const k = ease((t - FLOW_END + 140 - p.delay) / (GATHER_END - FLOW_END));
            const x = p.x0 + (p.tx - p.x0) * k, y = (fy % (h + 40)) + (p.ty - (fy % (h + 40))) * k;
            const size = 12 + (p.size - 12) * k;
            ctx.globalAlpha = .22 + (p.alpha - .22) * k;
            if (k < 1 && Math.random() < .025) p.digit = p.digit === '0' ? '1' : '0';
            if (size < 3) { ctx.beginPath(); ctx.arc(x, y, Math.max(.5, size * .35), 0, Math.PI * 2); ctx.fill(); }
            else { ctx.font = font(size); ctx.fillText(p.digit, x, y); }
          }
          ctx.globalAlpha = 1;
          if (t < DONE_AT - 120 && !done) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      };
      draw();
    }
    return () => {
      window.clearTimeout(liftTimer); window.clearTimeout(doneTimer); window.clearTimeout(skipTimer); cancelAnimationFrame(raf);
      dismissRef.current = () => {};
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  if (phase === 'gone') return null;
  return (
    <div className={`cx-intro is-${phase}`}>
      <canvas ref={canvasRef} aria-hidden="true" />
      <button className="cx-intro-skip" type="button" onClick={() => dismissRef.current()}>Skip intro</button>
    </div>
  );
}
