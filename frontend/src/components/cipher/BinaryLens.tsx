'use client';
import { useEffect, useRef } from 'react';
import { createCypherDigitField } from './digitField';

// The Cypher mark: a lens of 0/1 digits that grow toward the centre.
// While `active`, digits flip and a pulse sweeps across the lens.
export default function BinaryLens({ cols = 41, rows = 21, active = false, level = 0, className, label = 'Cypher', decorative = false }: { cols?: number; rows?: number; active?: boolean; level?: number; className?: string; label?: string; decorative?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activeRef = useRef(active);
  const levelRef = useRef(level);
  activeRef.current = active;
  levelRef.current = level;

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const digits = createCypherDigitField(cols, rows);
    let frame = 0, raf = 0, width = 0, height = 0, ink = '#000', last = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect(); const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width; height = rect.height; canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ink = getComputedStyle(canvas).color || '#000';
      draw(0);
    };
    const draw = (t: number) => {
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const cw = width / cols, rh = height / rows, max = Math.min(cw * 1.05, rh * 1.25);
      const sweep = activeRef.current ? ((t / 1400) % 1.6) - .3 : -9;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const dx = (c + .5) / cols * 2 - 1, dy = (r + .5) / rows * 2 - 1;
          const d = .55 * Math.hypot(dx, dy * 1.05) + .45 * (Math.abs(dx) * .92 + Math.abs(dy));
          let s = Math.max(0, 1 - d * 1.08);
          if (s <= .02) continue;
          const pulse = Math.exp(-(((c + .5) / cols - sweep) ** 2) / .012);
          const voice = Math.max(0, Math.min(1, levelRef.current));
          s = Math.min(1, Math.pow(s, .75) * (1 + pulse * .55 + voice * .5));
          const size = Math.max(1.2, max * s);
          ctx.globalAlpha = Math.min(1, .25 + s * 1.1);
          if (max < 6) { ctx.beginPath(); ctx.arc((c + .5) * cw, (r + .5) * rh, Math.max(.35, max * .42 * s), 0, Math.PI * 2); ctx.fill(); continue; }
          ctx.font = `${s > .5 ? 400 : 500} ${size.toFixed(1)}px -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', 'Inter Variable', sans-serif`;
          ctx.fillText(size < 3 ? '·' : digits[r * cols + c], (c + .5) * cw, (r + .5) * rh);
        }
      }
      ctx.globalAlpha = 1;
    };
    let motionEnabled = document.documentElement.dataset.motion !== 'false';
    const shouldAnimate = () => activeRef.current && motionEnabled && !reduce.matches && !document.hidden;
    const tick = (t: number) => {
      if (shouldAnimate()) {
        if (t - last > 70) { for (let i = 0; i < Math.ceil(digits.length / 18); i++) { const k = Math.floor(Math.random() * digits.length); digits[k] = digits[k] === '0' ? '1' : '0'; } last = t; }
        draw(t); frame = 1;
        raf = requestAnimationFrame(tick);
      } else {
        if (frame) { draw(0); frame = 0; }
        raf = 0;
      }
    };
    const syncMotion = () => {
      motionEnabled = document.documentElement.dataset.motion !== 'false';
      if (shouldAnimate() && !raf) raf = requestAnimationFrame(tick);
      else if (!shouldAnimate() && raf) { cancelAnimationFrame(raf); raf = 0; if (frame) { draw(0); frame = 0; } }
    };
    const onVisibility = () => syncMotion();
    const observer = new ResizeObserver(resize); observer.observe(canvas);
    const scheme = window.matchMedia('(prefers-color-scheme: dark)'); const recolor = () => requestAnimationFrame(resize);
    scheme.addEventListener('change', recolor);
    const themeObserver = new MutationObserver(() => { recolor(); syncMotion(); }); themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'data-motion'] });
    reduce.addEventListener('change', syncMotion);
    document.addEventListener('visibilitychange', onVisibility);
    resize(); syncMotion();
    return () => { if (raf) cancelAnimationFrame(raf); observer.disconnect(); themeObserver.disconnect(); scheme.removeEventListener('change', recolor); reduce.removeEventListener('change', syncMotion); document.removeEventListener('visibilitychange', onVisibility); };
  }, [active, cols, rows]);

  return <canvas ref={canvasRef} className={className} role={decorative ? undefined : 'img'} aria-label={decorative ? undefined : label} aria-hidden={decorative || undefined} />;
}
