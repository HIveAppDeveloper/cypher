'use client';
import { useEffect, useRef, useState } from 'react';
import type { Lead, SignalKind } from '../../lib/cipher/engine';
import { SIGNAL_MAX } from '../../lib/cipher/engine';

// Prospect Brain: every account is a node in a rotating 3D field.
// Distance from the core = how many buying signals are firing (hot accounts sit at the centre).
// Direction = which signals drive it; each signal is a hub on the outer shell.
type V3 = [number, number, number];
type Node = { id: string; lead: Lead; pos: V3; born: number };
type Projected = { x: number; y: number; z: number; f: number };

const HUBS: { kind: SignalKind; label: string; dir: V3 }[] = [
  { kind: 'hiring', label: 'HIRING', dir: norm([1, .62, .7]) },
  { kind: 'raising', label: 'RAISING', dir: norm([-1, .62, -.7]) },
  { kind: 'spending', label: 'SPENDING', dir: norm([1, -.62, -.7]) },
  { kind: 'news', label: 'MOMENTUM', dir: norm([-1, -.62, .7]) },
];
const SHELL = buildShell(340);

function norm(v: V3): V3 { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
function hash(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967295; }
function buildShell(n: number): { p: V3; d: string }[] {
  const out: { p: V3; d: string }[] = []; const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2, r = Math.sqrt(1 - y * y), th = golden * i;
    let x = Math.cos(th) * r; const z = Math.sin(th) * r;
    x += Math.sign(x) * .07; // a shallow fissure between two hemispheres
    out.push({ p: [x * 1.32, y * .86, z * 1.02], d: i % 3 ? (i % 2 ? '1' : '0') : '·' });
  }
  return out;
}
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
  const state = useRef({ yaw: .6, pitch: -.32, zoom: 1, hover: null as string | null, drag: null as null | { x: number; y: number; moved: number }, nodes: new Map<string, Node>(), running, selected, filter, onSelect, links: [] as [string, string][] });
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
    const list = Array.from(st.nodes.values()); const links: [string, string][] = [];
    for (const n of list) {
      const near = list.filter(m => m !== n).map(m => ({ m, d: Math.hypot(m.pos[0] - n.pos[0], m.pos[1] - n.pos[1], m.pos[2] - n.pos[2]) })).sort((a, b) => a.d - b.d).slice(0, 2);
      for (const { m } of near) if (!links.some(([a, b]) => (a === m.id && b === n.id))) links.push([n.id, m.id]);
    }
    st.links = links;
  }, [leads, running]);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const st = state.current; const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    let w = 0, h = 0, raf = 0, colors = { ink: '#000', ink2: '#666', card: '#fff' };
    let projected = new Map<string, Projected & { r: number }>();

    const readColors = () => { const cs = getComputedStyle(canvas); colors = { ink: cs.getPropertyValue('--cx-label').trim() || '#000', ink2: cs.getPropertyValue('--cx-label-2').trim() || '#666', card: cs.getPropertyValue('--cx-card').trim() || '#fff' }; };
    const resize = () => { const r = canvas.getBoundingClientRect(); const dpr = Math.min(window.devicePixelRatio || 1, 2); w = r.width; h = r.height; canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); readColors(); };
    const project = (p: V3): Projected => {
      const cy = Math.cos(st.yaw), sy = Math.sin(st.yaw), cp = Math.cos(st.pitch), sp = Math.sin(st.pitch);
      const x1 = p[0] * cy - p[2] * sy, z1 = p[0] * sy + p[2] * cy;
      const y2 = p[1] * cp - z1 * sp, z2 = p[1] * sp + z1 * cp;
      const f = 3.2 / (3.2 + z2); const scale = Math.min(w / 2.9, h / 2.05) * st.zoom;
      return { x: w / 2 + x1 * f * scale, y: h / 2 + y2 * f * scale, z: z2, f };
    };
    const matches = (l: Lead) => st.filter === 'All' || l.tier === st.filter;

    const draw = (t: number) => {
      if (!st.drag && !reduce.matches) st.yaw += st.running ? .0042 : .0016;
      ctx.clearRect(0, 0, w, h);
      // shell
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (let i = 0; i < SHELL.length; i++) {
        const s = SHELL[i]; const q = project(s.p); const depth = (1 - q.z) / 2;
        let a = .05 + depth * .2; if (st.running) a *= .75 + .5 * Math.max(0, Math.sin(t / 220 + i * .7));
        ctx.globalAlpha = a; ctx.fillStyle = colors.ink;
        ctx.font = `${(7 + depth * 5) * q.f * st.zoom}px -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter Variable', sans-serif`;
        ctx.fillText(s.d, q.x, q.y);
      }
      // hubs
      for (const hub of HUBS) {
        const q = project([hub.dir[0] * 1.42, hub.dir[1] * .98, hub.dir[2] * 1.15]); const depth = (1 - q.z) / 2;
        ctx.globalAlpha = .35 + depth * .55; ctx.strokeStyle = colors.ink; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(q.x, q.y, 4 * q.f, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = colors.ink2; ctx.font = `600 ${10.5 * Math.max(.85, q.f)}px -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter Variable', sans-serif`;
        ctx.fillText(hub.label, q.x, q.y - 14 * q.f);
      }
      // core
      const core = project([0, 0, 0]);
      ctx.globalAlpha = st.running ? .14 + .1 * Math.sin(t / 260) : .1; ctx.fillStyle = colors.ink;
      ctx.beginPath(); ctx.arc(core.x, core.y, 26 * core.f * st.zoom, 0, Math.PI * 2); ctx.fill();
      // nodes
      projected = new Map();
      const nodes = Array.from(st.nodes.values());
      for (const n of nodes) { const q = project(n.pos); const grow = Math.min(1, (t - n.born) / 650); const e = 1 - Math.pow(1 - Math.max(0, grow), 3); projected.set(n.id, { ...q, r: (3 + n.lead.score / 100 * 7.5) * q.f * Math.sqrt(st.zoom) * e }); }
      const focus = st.hover || st.selected;
      // synapses
      ctx.lineWidth = .8;
      for (const [a, b] of st.links) {
        const p = projected.get(a), q = projected.get(b); if (!p || !q || !p.r || !q.r) continue;
        const lit = focus === a || focus === b;
        ctx.globalAlpha = lit ? .55 : .1 + ((2 - p.z - q.z) / 4) * .12; ctx.strokeStyle = colors.ink;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
      }
      // focus wires to hubs
      if (focus && st.nodes.get(focus)) {
        const n = st.nodes.get(focus)!; const p = projected.get(focus)!;
        ctx.setLineDash([3, 4]);
        for (const s of n.lead.signals) { const hub = HUBS.find(x => x.kind === s.kind)!; const q = project([hub.dir[0] * 1.42, hub.dir[1] * .98, hub.dir[2] * 1.15]); ctx.globalAlpha = .45; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke(); }
        ctx.setLineDash([]);
      }
      const order = nodes.slice().sort((a, b) => projected.get(b.id)!.z - projected.get(a.id)!.z);
      const labelled = new Set(nodes.filter(n => n.lead.tier === 'Hot').sort((a, b) => b.lead.score - a.lead.score).slice(0, 6).map(n => n.id));
      for (const n of order) {
        const q = projected.get(n.id)!; if (q.r <= .2) continue;
        const depth = (1 - q.z) / 2; const on = matches(n.lead); const isFocus = n.id === focus;
        const base = on ? .45 + depth * .55 : .12;
        ctx.globalAlpha = base;
        if (n.lead.tier === 'Hot') {
          ctx.globalAlpha = base * .16; ctx.fillStyle = colors.ink; ctx.beginPath(); ctx.arc(q.x, q.y, q.r * 2.3, 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = base; ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, Math.PI * 2); ctx.fill();
        } else if (n.lead.tier === 'Warm') {
          ctx.globalAlpha = base * .7; ctx.fillStyle = colors.ink; ctx.beginPath(); ctx.arc(q.x, q.y, q.r * .85, 0, Math.PI * 2); ctx.fill();
        } else {
          ctx.strokeStyle = colors.ink; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(q.x, q.y, q.r * .7, 0, Math.PI * 2); ctx.stroke();
        }
        if (n.lead.stage !== 'drafted') { ctx.globalAlpha = base; ctx.strokeStyle = colors.ink; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(q.x, q.y, q.r + 4, 0, Math.PI * 2); ctx.stroke(); }
        if (isFocus) { ctx.globalAlpha = 1; ctx.strokeStyle = colors.ink; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(q.x, q.y, q.r + 7, 0, Math.PI * 2); ctx.stroke(); }
        if ((labelled.has(n.id) && on) || isFocus) {
          ctx.globalAlpha = isFocus ? 1 : .55 + depth * .45; ctx.fillStyle = colors.ink; ctx.textAlign = 'left';
          ctx.font = `${isFocus ? 600 : 500} 12.5px -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter Variable', sans-serif`;
          ctx.fillText(n.lead.company.name, q.x + q.r + 8, q.y); ctx.textAlign = 'center';
        }
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    };

    const pick = (x: number, y: number) => {
      let best: string | null = null, bestD = Infinity;
      for (const [id, q] of Array.from(projected)) { const d = Math.hypot(q.x - x, q.y - y); if (d < Math.max(10, q.r + 6) && d < bestD) { best = id; bestD = d; } }
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
      <canvas ref={canvasRef} role="img" aria-label={`Prospect brain with ${leads.length} accounts. ${tiers('Hot')} hot accounts sit at the core. Use the Accounts tab for a list.`} />
      <div className="cx-brain-title">
        <h2>Prospect Brain</h2>
        <p>The closer to the core, the more buying signals are firing. Drag to rotate, click a prospect to open it.</p>
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
        <li><i className="ring" />In sequence</li>
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
