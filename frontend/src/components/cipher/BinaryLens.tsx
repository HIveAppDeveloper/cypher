'use client';
import { useEffect, useRef, type RefObject } from 'react';
import { createCypherDigitField } from './digitField';

// The Cypher mark: a lens of 0/1 digits that grow toward the centre.
// While `active`, digits flip and a pulse sweeps across the lens.
export default function BinaryLens({ cols = 41, rows = 17, active = false, level = 0, levelSource, className, decorative = false, label = 'Cypher' }: { cols?: number; rows?: number; active?: boolean; level?: number; levelSource?: RefObject<number>; className?: string; decorative?: boolean; label?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activeRef = useRef(active);
  const levelRef = useRef(level);
  const sourceRef = useRef(levelSource);
  const syncRef = useRef<() => void>(() => {});
  activeRef.current = active;
  levelRef.current = level;
  sourceRef.current = levelSource;

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    let renderCols = cols, renderRows = rows, digits = createCypherDigitField(cols, rows);
    let frame = 0, raf = 0, width = 0, height = 0, ink = '#000', last = 0, lastPaint = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect(); const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width; height = rect.height;
      renderCols = Math.min(cols, Math.max(5, Math.floor(width / 6) | 1));
      renderRows = Math.min(rows, Math.max(3, Math.floor(height / 7) | 1));
      digits = createCypherDigitField(renderCols, renderRows);
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ink = getComputedStyle(canvas).color || '#000';
      draw(0);
    };
    const draw = (t: number) => {
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const cw = width / renderCols, rh = height / renderRows, max = Math.min(cw * 1.05, rh * 1.25);
      const sweep = activeRef.current ? ((t / 2600) % 1.8) - .4 : -9;
      const voice = Math.max(0, Math.min(1, sourceRef.current?.current ?? levelRef.current));
      const breath = activeRef.current ? .96 + Math.sin(t / 900) * .04 : 1;
      for (let r = 0; r < renderRows; r++) {
        for (let c = 0; c < renderCols; c++) {
          const dx = (c + .5) / renderCols * 2 - 1, dy = (r + .5) / renderRows * 2 - 1;
          const d = .55 * Math.hypot(dx, dy * 1.05) + .45 * (Math.abs(dx) * .92 + Math.abs(dy));
          let s = Math.max(0, 1 - d * 1.08);
          if (s <= .02) continue;
          const pulse = Math.exp(-(((c + .5) / renderCols - sweep) ** 2) / .025);
          s = Math.min(1, Math.pow(s, .75) * (breath + pulse * .36 + voice * .35));
          const size = Math.max(Math.min(6, max * .75), max * s);
          ctx.globalAlpha = Math.min(1, .22 + s * .8 + pulse * .16 + voice * .12);
          ctx.font = `400 ${size.toFixed(1)}px ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace`;
          const wave = activeRef.current ? Math.sin(t / 650 + dx * 3) * rh * .1 * s : 0;
          ctx.fillText(digits[r * renderCols + c], (c + .5) * cw, (r + .5) * rh + wave);
        }
      }
      ctx.globalAlpha = 1;
    };
    let motionEnabled = document.documentElement.dataset.motion !== 'false';
    let visible = true;
    const shouldAnimate = () => activeRef.current && visible && motionEnabled && !reduce.matches && !document.hidden;
    const tick = (t: number) => {
      if (shouldAnimate()) {
        if (t - last > 100) { for (let i = 0; i < Math.ceil(digits.length / 24); i++) { const k = Math.floor(Math.random() * digits.length); digits[k] = digits[k] === '0' ? '1' : '0'; } last = t; }
        if (t - lastPaint >= 32) { draw(t); lastPaint = t; frame = 1; }
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
    syncRef.current = syncMotion;
    const intersection = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; syncMotion(); });
    intersection.observe(canvas);
    const observer = new ResizeObserver(resize); observer.observe(canvas);
    const scheme = window.matchMedia('(prefers-color-scheme: dark)'); const recolor = () => requestAnimationFrame(resize);
    scheme.addEventListener('change', recolor);
    const themeObserver = new MutationObserver(() => { recolor(); syncMotion(); }); themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'data-motion'] });
    reduce.addEventListener('change', syncMotion);
    document.addEventListener('visibilitychange', onVisibility);
    resize(); syncMotion();
    return () => { syncRef.current = () => {}; if (raf) cancelAnimationFrame(raf); intersection.disconnect(); observer.disconnect(); themeObserver.disconnect(); scheme.removeEventListener('change', recolor); reduce.removeEventListener('change', syncMotion); document.removeEventListener('visibilitychange', onVisibility); };
  }, [cols, rows]);
  useEffect(() => { syncRef.current(); }, [active]);

  return <canvas ref={canvasRef} className={className} role={decorative ? undefined : 'img'} aria-hidden={decorative || undefined} aria-label={decorative ? undefined : label} />;
}
