'use client';
import { useEffect, useRef, useState } from 'react';
import type { Lead, SignalKind } from '../../lib/cipher/engine';
import { SIGNAL_MAX } from '../../lib/cipher/engine';

// Prospect Brain: a rotating 3D graph of every account in the territory.
// Distance from the centre = how many buying signals are firing (hot accounts sit in the middle).
// Each account links to the signal hubs (hiring, raising, spending, momentum) that drive it.
type V3 = [number, number, number];
type Node = { id: string; lead: Lead; pos: V3; born: number };
type Projected = { x: number; y: number; z: number; f: number };

const HUBS: { kind: SignalKind; label: string; dir: V3 }[] = [
  { kind: 'hiring', label: 'HIRING', dir: norm([1, .62, .7]) },
  { kind: 'raising', label: 'RAISING', dir: norm([-1, .62, -.7]) },
  { kind: 'spending', label: 'SPENDING', dir: norm([1, -.62, -.7]) },
  { kind: 'news', label: 'MOMENTUM', dir: norm([-1, -.62, .7]) },
];

function norm(v: V3): V3 { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
function hash(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967295; }
function placeLead(lead: Lead): V3 {
  let v: V3 = [0, 0, 0];
  for (const s of lead.signals) { const hub = HUBS.find(h => h.kind === s.kind); if (!hub) continue; const w = s.strength / SIGNAL_MAX[s.kind]; v = [v[0] + hub.dir[0] * w, v[1] + hub.dir[1] * w, v[2] + hub.dir[2] * w]; }
  const a = hash(lead.id) * Math.PI * 2, b = hash(lead.id + 'b') * 2 - 1, c = Math.sqrt(1 - b * b);
  const jitter: V3 = [Math.cos(a) * c, b, Math.sin(a) * c];
  const dir = norm(Math.hypot(...v) < .25 ? [v[0] + jitter[0] * .6, v[1] + jitter[1] * .6, v[2] + jitter[2] * .6] : [v[0] + jitter[0] * .25, v[1] + jitter[1] * .25, v[2] + jitter[2] * .25]);
  const r = .14 + (1 - lead.score / 100) * .78 + (hash(lead.id + 'r') - .5) * .08;
  return [dir[0] * r * 1.25, dir[1] * r * .85, dir[2] * r];
}

export default function ProspectBrain({ leads, running, selected, filter, onSelect }: { leads: Lead[]; running: boolean; selected: string | null; filter: 'All' | Lead['tier']; onSelect: (id: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const state = useRef({ yaw: .6, pitch: -.32, zoom: 1, hover: null as string | null, drag: null as null | { x: number; y: number; moved: number }, nodes: new Map<string, Node>(), running, selected, filter, onSelect });
  const [hoverLead, setHoverLead] = useState<Lead | null>(null);
  state.current.running = running; state.current.selected = selected; state.current.filter = filter; state.current.onSelect = onSelect;

  useEffect(() => {
    const st = state.current; const now = performance.now(); const ids = new Set(leads.map(l => l.id));
    for (const id of Array.from(st.nodes.keys())) if (!ids.has(id)) st.nodes.delete(id);
    leads.forEach((lead, i) => {
      const existing = st.nodes.get(lead.id);
      if (existing) existing.lead = lead;
      else st.nodes.set(lead.id, { id: lead.id, lead, pos: placeLead(lead), born: leads.length > 6 && !running ? now - 2000 + i * 40 : now });
    });
  }, [leads, running]);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const st = state.current; const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    let w = 0, h = 0, raf = 0, colors = { ink: '#000', ink2: '#8e8e93', ink3: '#c7c7cc', card: '#fff' };
    let projected = new Map<string, Projected & { r: number }>();

    const readColors = () => { const cs = getComputedStyle(canvas); const dark = cs.getPropertyValue('--cx-card').trim() !== '#ffffff'; colors = { ink: cs.getPropertyValue('--cx-label').trim() || '#000', ink2: dark ? '#8e8e93' : '#8e8e93', ink3: dark ? '#48484a' : '#c7c7cc', card: cs.getPropertyValue('--cx-card').trim() || '#fff' }; };
    const resize = () => { const r = canvas.getBoundingClientRect(); const dpr = Math.min(window.devicePixelRatio || 1, 2); w = r.width; h = r.height; canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); readColors(); };
    const project = (p: V3): Projected => {
      const cy = Math.cos(st.yaw), sy = Math.sin(st.yaw), cp = Math.cos(st.pitch), sp = Math.sin(st.pitch);
      const x1 = p[0] * cy - p[2] * sy, z1 = p[0] * sy + p[2] * cy;
      const y2 = p[1] * cp - z1 * sp, z2 = p[1] * sp + z1 * cp;
      const f = 3.2 / (3.2 + z2); const scale = Math.min(w / 3.2, h / 2.5) * st.zoom;
      return { x: w / 2 + x1 * f * scale, y: h / 2 + 24 + y2 * f * scale, z: z2, f };
    };
    const matches = (l: Lead) => st.filter === 'All' || l.tier === st.filter;

    const FONT = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter Variable', sans-serif";
    const hubPos = (hub: typeof HUBS[number]): V3 => [hub.dir[0] * 1.3, hub.dir[1] * .9, hub.dir[2] * 1.05];
    const tierColor = (tier: Lead['tier']) => (tier === 'Hot' ? colors.ink : tier === 'Warm' ? colors.ink2 : colors.ink3);

    const draw = (t: number) => {
      if (!st.drag && !st.hover && !reduce.matches) st.yaw += st.running ? .004 : .0015;
      ctx.clearRect(0, 0, w, h);
      ctx.textBaseline = 'middle';
      const zs = Math.sqrt(st.zoom);
      const hubs = HUBS.map(hub => ({ hub, q: project(hubPos(hub)) }));
      projected = new Map();
      const nodes = Array.from(st.nodes.values());
      for (const n of nodes) {
        const q = project(n.pos); const grow = Math.min(1, Math.max(0, (t - n.born) / 600)); const e = 1 - Math.pow(1 - grow, 3);
        projected.set(n.id, { ...q, r: (3.5 + n.lead.score / 100 * 6) * q.f * zs * e });
      }
      const focus = st.hover || st.selected;
      const focusLead = focus ? st.nodes.get(focus)?.lead : undefined;

      // edges: each prospect to the signal hubs that drive it
      ctx.lineWidth = 1;
      for (const n of nodes) {
        const p = projected.get(n.id)!; if (p.r <= .2) continue;
        const on = matches(n.lead);
        for (const sig of n.lead.signals) {
          const hq = hubs.find(x => x.hub.kind === sig.kind)!.q;
          const lit = n.id === focus;
          ctx.globalAlpha = lit ? .9 : on ? .1 + (1 - (p.z + hq.z) / 2) * .08 : .04;
          ctx.strokeStyle = lit ? colors.ink : colors.ink2;
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(hq.x, hq.y); ctx.stroke();
        }
      }

      // hubs
      for (const { hub, q } of hubs) {
        const lit = !!focusLead?.signals.some(s => s.kind === hub.kind);
        ctx.globalAlpha = 1; ctx.fillStyle = colors.card; ctx.strokeStyle = lit ? colors.ink : colors.ink2; ctx.lineWidth = lit ? 2 : 1.25;
        ctx.beginPath(); ctx.arc(q.x, q.y, 9 * q.f * zs, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = lit ? colors.ink : colors.ink2; ctx.textAlign = 'center';
        ctx.font = `600 11px ${FONT}`;
        ctx.fillText(hub.label, q.x, q.y + 9 * q.f * zs + 12);
      }

      // prospects, back to front
      const order = nodes.slice().sort((a, b) => projected.get(b.id)!.z - projected.get(a.id)!.z);
      for (const n of order) {
        const q = projected.get(n.id)!; if (q.r <= .2) continue;
        const on = matches(n.lead), isFocus = n.id === focus;
        ctx.globalAlpha = on ? 1 : .18;
        ctx.fillStyle = tierColor(n.lead.tier);
        ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = colors.card; ctx.lineWidth = 1.5; ctx.stroke();
        if (isFocus) { ctx.strokeStyle = colors.ink; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(q.x, q.y, q.r + 4, 0, Math.PI * 2); ctx.stroke(); }
      }

      // labels, front-most and highest-scoring first, skipping collisions
      const placed: { x: number; y: number; w: number }[] = [];
      const fits = (x: number, y: number, tw: number) => placed.every(r => x + tw / 2 + 4 < r.x - r.w / 2 || x - tw / 2 - 4 > r.x + r.w / 2 || Math.abs(y - r.y) > 14);
      const labelOrder = nodes.slice().sort((a, b) => (b.id === focus ? 1 : 0) - (a.id === focus ? 1 : 0) || b.lead.score - a.lead.score);
      ctx.textAlign = 'center';
      for (const n of labelOrder) {
        const q = projected.get(n.id)!; if (q.r <= .2 || (!matches(n.lead) && n.id !== focus)) continue;
        const isFocus = n.id === focus;
        ctx.font = `${isFocus ? 600 : n.lead.tier === 'Hot' ? 600 : 400} ${isFocus ? 13 : 11.5}px ${FONT}`;
        const tw = ctx.measureText(n.lead.company.name).width, ly = q.y + q.r + 10;
        if (!isFocus && !fits(q.x, ly, tw)) continue;
        placed.push({ x: q.x, y: ly, w: tw });
        ctx.globalAlpha = isFocus ? 1 : n.lead.tier === 'Hot' ? .95 : .7;
        ctx.fillStyle = isFocus || n.lead.tier === 'Hot' ? colors.ink : colors.ink2;
        ctx.fillText(n.lead.company.name, q.x, ly);
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    };

    const pick = (x: number, y: number) => {
      let best: string | null = null, bestD = Infinity;
      for (const [id, q] of Array.from(projected)) { const d = Math.hypot(q.x - x, q.y - y); if (d < Math.max(14, q.r + 8) && d < bestD) { best = id; bestD = d; } }
      return best;
    };
    const local = (e: PointerEvent) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const down = (e: PointerEvent) => { st.drag = { x: e.clientX, y: e.clientY, moved: 0 }; canvas.setPointerCapture(e.pointerId); };
    const move = (e: PointerEvent) => {
      if (st.drag) {
        const dx = e.clientX - st.drag.x, dy = e.clientY - st.drag.y; st.drag.moved += Math.abs(dx) + Math.abs(dy);
        st.yaw += dx * .008; st.pitch = Math.max(-1.2, Math.min(1.2, st.pitch + dy * .006)); st.drag.x = e.clientX; st.drag.y = e.clientY;
        return;
      }
      const { x, y } = local(e); const id = pick(x, y);
      if (id !== st.hover) { st.hover = id; setHoverLead(id ? st.nodes.get(id)?.lead ?? null : null); canvas.style.cursor = id ? 'pointer' : 'grab'; }
    };
    const up = (e: PointerEvent) => {
      const d = st.drag; st.drag = null;
      if (d && d.moved < 6) { const { x, y } = local(e); const id = pick(x, y); if (id) st.onSelect(id); }
    };
    const leave = () => { if (!st.drag) { st.hover = null; setHoverLead(null); } };
    const wheel = (e: WheelEvent) => { if (!e.ctrlKey && !e.metaKey) return; e.preventDefault(); st.zoom = Math.max(.6, Math.min(2.4, st.zoom * Math.exp(-e.deltaY * .01))); };

    const ro = new ResizeObserver(resize); ro.observe(canvas);
    const scheme = window.matchMedia('(prefers-color-scheme: dark)'); const recolor = () => requestAnimationFrame(readColors);
    scheme.addEventListener('change', recolor);
    const mo = new MutationObserver(recolor); mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', up); canvas.addEventListener('pointerleave', leave); canvas.addEventListener('wheel', wheel, { passive: false });
    resize(); raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); mo.disconnect(); scheme.removeEventListener('change', recolor); canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointerleave', leave); canvas.removeEventListener('wheel', wheel); };
  }, []);

  const zoom = (k: number) => { state.current.zoom = k === 0 ? 1 : Math.max(.6, Math.min(2.4, state.current.zoom * k)); if (k === 0) { state.current.yaw = .6; state.current.pitch = -.32; } };
  const tiers = (t: Lead['tier']) => leads.filter(l => l.tier === t).length;

  return (
    <div className="cx-brain">
      <canvas ref={canvasRef} role="img" aria-label={`Prospect brain with ${leads.length} accounts. ${tiers('Hot')} hot accounts sit at the centre. Use the Accounts tab for a list.`} />
      <div className="cx-brain-title">
        <h2>Prospect Brain</h2>
        <p>The closer to the centre, the more buying signals are firing. Lines show which signals drive each account. Drag to rotate, click to open.</p>
      </div>
      <div className="cx-brain-zoom" role="group" aria-label="Zoom">
        <button type="button" aria-label="Zoom out" onClick={() => zoom(1 / 1.2)}>−</button>
        <button type="button" aria-label="Reset view" onClick={() => zoom(0)}>Reset</button>
        <button type="button" aria-label="Zoom in" onClick={() => zoom(1.2)}>+</button>
      </div>
      <ul className="cx-brain-legend" aria-label="Legend">
        <li><i className="hot" />Hot <b>{tiers('Hot')}</b></li>
        <li><i className="warm" />Warm <b>{tiers('Warm')}</b></li>
        <li><i className="watch" />Watch <b>{tiers('Watch')}</b></li>
      </ul>
      {hoverLead ? (
        <div className="cx-brain-tip" aria-hidden="true">
          <b>{hoverLead.company.name}</b><span>{hoverLead.company.ticker} · score {hoverLead.score} · {hoverLead.tier}</span><small>{hoverLead.why}</small>
        </div>
      ) : null}
      {!leads.length ? <div className="cx-brain-empty">{running ? 'Mapping your territory…' : 'Run Outbound to map your territory'}</div> : null}
    </div>
  );
}
