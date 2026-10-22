'use client';

import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { binaryWaveMetrics, drawBinaryWave } from '../lib/binary-wave';

/** True when the surface behind the mark is dark, so the ribbon draws in light ink. */
function surfaceIsDark(element: HTMLElement) {
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const match = getComputedStyle(node).backgroundColor.match(/^rgba?\(([^)]+)\)$/);
    if (!match) continue;
    const channels = match[1].split(',').map(Number);
    if ((channels[3] ?? 1) > 0.5) return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2] < 140;
  }
  return false;
}

/**
 * The animated Open GrokBot mark.
 *
 * It settles in on first paint, drifts while idle, swells and darkens the
 * digits nearest the pointer, and runs faster while `active` (a task is
 * starting). Ink follows the surface it sits on, so the sign-in tile and the
 * dark appearance get the ribbon in light digits. Reduced motion paints one
 * settled frame and never starts a frame loop; a mark scrolled out of view
 * stops drawing.
 */
export function BinaryWaveMark({
  width = 28,
  height = 28,
  active = false,
  className,
}: {
  width?: number;
  height?: number;
  active?: boolean;
  className?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const pointer = useRef({ across: Number.NaN, inside: false });
  const busy = useRef(active);
  useEffect(() => {
    busy.current = active;
  }, [active]);

  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext('2d');
    if (!element || !context) return;

    let dark = surfaceIsDark(element);
    const density = Math.min(window.devicePixelRatio || 1, 2);
    element.width = Math.round(width * density);
    element.height = Math.round(height * density);
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const scheme = window.matchMedia('(prefers-color-scheme: dark)');

    let phase = 0.42;
    let reveal = 0;
    let hover = 0;
    let energy = 0;
    let time = 0;
    let handle = 0;
    let onScreen = true;
    let last = performance.now();

    function paint() {
      context!.setTransform(density, 0, 0, density, 0, 0);
      drawBinaryWave(context!, { width, height, phase, reveal, hover, pointer: pointer.current.across, energy, time, invert: dark });
    }

    function step(now: number) {
      handle = 0;
      const elapsed = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      energy += ((busy.current ? 1 : 0) - energy) * Math.min(1, elapsed * 3);
      const wantedHover = pointer.current.inside ? 1 : 0;
      hover += (wantedHover - hover) * Math.min(1, elapsed * (wantedHover ? 6 : 2.5));
      reveal = Math.min(1, reveal + elapsed * 1.9);
      time += elapsed;
      phase += elapsed * (0.5 + energy * 2 + hover * 0.7);
      paint();
      if (!motion.matches && onScreen) handle = requestAnimationFrame(step);
    }

    function play() {
      if (handle) return;
      if (motion.matches) {
        reveal = 1;
        hover = 0;
        energy = busy.current ? 1 : 0;
        paint();
        return;
      }
      last = performance.now();
      handle = requestAnimationFrame(step);
    }

    function pause() {
      if (handle) cancelAnimationFrame(handle);
      handle = 0;
    }

    function restart() {
      pause();
      play();
    }

    // Stylesheets and appearance can settle after the first frame: re-read the surface then.
    function resurface() {
      dark = surfaceIsDark(element!);
      paint();
    }

    const observer = new IntersectionObserver(entries => {
      onScreen = entries[0]?.isIntersecting ?? true;
      if (onScreen) play();
      else pause();
    });
    observer.observe(element);

    const onVisibility = () => {
      if (document.hidden) pause();
      else if (onScreen) play();
    };
    document.addEventListener('visibilitychange', onVisibility);
    motion.addEventListener('change', restart);
    scheme.addEventListener('change', resurface);
    window.addEventListener('load', resurface);

    play();
    // Canvas text needs the webfont; the settled (reduced-motion) frame may have painted before it loaded.
    document.fonts?.ready.then(() => {
      dark = surfaceIsDark(element);
      if (!handle) paint();
    });

    return () => {
      pause();
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      motion.removeEventListener('change', restart);
      scheme.removeEventListener('change', resurface);
      window.removeEventListener('load', resurface);
    };
  }, [width, height]);

  function track(event: ReactPointerEvent<HTMLCanvasElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const { padX, bandWidth } = binaryWaveMetrics(width, height);
    const across = (event.clientX - box.left - padX) / Math.max(1, bandWidth);
    pointer.current.across = across < 0 ? 0 : across > 1 ? 1 : across;
    pointer.current.inside = true;
  }

  return (
    <canvas
      ref={canvas}
      className={className}
      aria-hidden="true"
      style={{ display: 'block', width, height }}
      onPointerMove={track}
      onPointerEnter={track}
      onPointerLeave={() => {
        pointer.current.inside = false;
        pointer.current.across = Number.NaN;
      }}
    />
  );
}
