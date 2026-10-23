'use client';
import { useEffect, useRef, useState } from 'react';
import type { Lead, SignalKind } from '../../lib/cipher/engine';
import { SIGNAL_MAX, accountIntel } from '../../lib/cipher/engine';

const KIND_LABEL: Record<SignalKind, string> = { hiring: 'Hiring', raising: 'Raising', spending: 'Spending', news: 'Momentum' };
const STAGE_LABEL: Record<Lead['stage'], string> = { found: 'Found', researched: 'Researched', drafted: 'Ready to send', sent: 'In sequence', replied: 'Replied', meeting: 'Meeting booked' };

// Prospect Brain: a rotating 3D scatter of every account in the territory.
// X = hiring signal, Y = overall score, Z = capital and momentum (raising, spending, 8-K activity).
type V3 = [number, number, number];
type Node = { id: string; lead: Lead; pos: V3; target: V3; born: number };
type Projected = { x: number; y: number; z: number; f: number };

function hash(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967295; }
// Axis placement in a [-1, 1] cube. Screen y grows downward, so a higher score is a smaller y.
function placeLead(lead: Lead): V3 {
  const str = (k: SignalKind) => lead.signals.find(s => s.kind === k)?.strength ?? 0;
  const j = (salt: string) => (hash(lead.id + salt) - .5) * .06;
  const x = str('hiring') / SIGNAL_MAX.hiring * 2 - 1;
  const y = -(lead.score / 100 * 2 - 1);
  const z = (str('raising') + str('spending') + str('news')) / (SIGNAL_MAX.raising + SIGNAL_MAX.spending + SIGNAL_MAX.news) * 2 - 1;
  return [x * .92 + j('x'), y * .92 + j('y'), z * .92 + j('z')];
}

export default function ProspectBrain({ leads, running, selected, filter, onSelect, highlight = [], busy = [] }: { leads: Lead[]; running: boolean; selected: string | null; filter: 'All' | Lead['tier']; onSelect: (id: string) => void; highlight?: string[]; busy?: string[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const state = useRef({ yaw: -.62, pitch: -.38, zoom: 1, hover: null as string | null, drag: null as null | { x: number; y: number; moved: number }, nodes: new Map<string, Node>(), running, selected, filter, onSelect, highlight, busy, pinned: null as string | null, pinnedAt: 0, setPinned: (id: string | null) => { void id; } });
  const [hoverLead, setHoverLead] = useState<Lead | null>(null);
  state.current.running = running; state.current.selected = selected; state.current.filter = filter; state.current.onSelect = onSelect; state.current.highlight = highlight; state.current.busy = busy; state.current.setPinned = setPinned;
  if (state.current.pinned !== pinned) { state.current.pinned = pinned; state.current.pinnedAt = typeof performance !== 'undefined' ? performance.now() : 0; }
  useEffect(() => { if (!pinned) return; const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setPinned(null); }; window.addEventListener('keydown', esc); return () => window.removeEventListener('keydown', esc); }, [pinned]);
  useEffect(() => { if (pinned && !leads.some(l => l.id === pinned)) setPinned(null); }, [leads, pinned]);

  useEffect(() => {
    const st = state.current; const now = performance.now(); const ids = new Set(leads.map(l => l.id));
    for (const id of Array.from(st.nodes.keys())) if (!ids.has(id)) st.nodes.delete(id);
    leads.forEach((lead, i) => {
      const existing = st.nodes.get(lead.id);
      if (existing) { existing.lead = lead; existing.target = placeLead(lead); }
      else { const pos = placeLead(lead); st.nodes.set(lead.id, { id: lead.id, lead, pos, target: pos, born: leads.length > 6 && !running ? now - 2000 + i * 40 : now }); }
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
      const f = 6 / (6 + z2); const scale = Math.min(w / 4.2, h / 3.7) * st.zoom;
      return { x: w / 2 + x1 * f * scale, y: h / 2 + 18 + y2 * f * scale, z: z2, f };
    };
    const matches = (l: Lead) => st.filter === 'All' || l.tier === st.filter;

    const FONT = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter Variable', sans-serif";
    const tierColor = (tier: Lead['tier']) => (tier === 'Hot' ? colors.ink : tier === 'Warm' ? colors.ink2 : colors.ink3);
    const line = (a: V3, b: V3, alpha: number, width = 1, color = colors.ink2) => { const p = project(a), q = project(b); ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke(); };
    const text = (v: V3, label: string, font: string, color: string, alpha = 1, align: CanvasTextAlign = 'center', dy = 0) => { const q = project(v); ctx.globalAlpha = alpha; ctx.fillStyle = color; ctx.font = font; ctx.textAlign = align; ctx.fillText(label, q.x, q.y + dy); };

    const draw = (t: number) => {
      if (!st.drag && !st.hover && !st.pinned && !reduce.matches) st.yaw += st.running ? .004 : .0015;
      ctx.clearRect(0, 0, w, h);
      ctx.textBaseline = 'middle';
      // floor grid (y = 1 is the floor: score 0) and back walls
      for (let i = 0; i <= 4; i++) {
        const v = -1 + i / 2;
        line([v, 1, -1], [v, 1, 1], i % 2 ? .1 : .18);
        line([-1, 1, v], [1, 1, v], i % 2 ? .1 : .18);
        line([-1, v, -1], [1, v, -1], .07); line([-1, v, -1], [-1, v, 1], .07);
      }
      // axes from the origin corner (-1, 1, -1)
      const o: V3 = [-1, 1, -1];
      line(o, [1, 1, -1], .9, 1.5, colors.ink); line(o, [-1, -1, -1], .9, 1.5, colors.ink); line(o, [-1, 1, 1], .9, 1.5, colors.ink);
      const axisFont = `600 11px ${FONT}`, tickFont = `400 10.5px ${FONT}`;
      text([1.2, 1, -1], 'X · HIRING', axisFont, colors.ink);
      text([-1, -1.16, -1], 'Y · SCORE', axisFont, colors.ink);
      text([-1, 1, 1.24], 'Z · CAPITAL & MOMENTUM', axisFont, colors.ink);
      for (const [v, label] of [[1, '0'], [0, '50'], [-1, '100']] as [number, string][]) text([-1.08, v, -1], label, tickFont, colors.ink2, .9, 'right');
      for (const [v, label] of [[-1, 'Low'], [1, 'High']] as [number, string][]) { text([v, 1.12, -1], label, tickFont, colors.ink2, .8); text([-1.1, 1.08, v], label, tickFont, colors.ink2, .8, 'right'); }

      const zs = Math.sqrt(st.zoom);
      projected = new Map();
      const nodes = Array.from(st.nodes.values());
      for (const n of nodes) {
        n.pos = [n.pos[0] + (n.target[0] - n.pos[0]) * .07, n.pos[1] + (n.target[1] - n.pos[1]) * .07, n.pos[2] + (n.target[2] - n.pos[2]) * .07];
        const q = project(n.pos); const grow = Math.min(1, Math.max(0, (t - n.born) / 600)); const e = 1 - Math.pow(1 - grow, 3);
        projected.set(n.id, { ...q, r: (3.5 + n.lead.score / 100 * 5.5) * q.f * zs * e });
      }
      const focus = st.hover || st.pinned || st.selected;
      // drop lines to the floor show where each prospect sits
      ctx.setLineDash([2, 3]);
      for (const n of nodes) {
        const q = projected.get(n.id)!; if (q.r <= .2) continue;
        const lit = n.id === focus;
        line(n.pos, [n.pos[0], 1, n.pos[2]], lit ? .8 : matches(n.lead) ? .22 : .06, 1, lit ? colors.ink : colors.ink2);
      }
      ctx.setLineDash([]);
      for (const n of nodes) {
        const q = projected.get(n.id)!; if (q.r <= .2 || !matches(n.lead)) continue;
        const f = project([n.pos[0], 1, n.pos[2]]); ctx.globalAlpha = n.id === focus ? .6 : .18; ctx.fillStyle = colors.ink2;
        ctx.beginPath(); ctx.ellipse(f.x, f.y, 2.2 * f.f, 1.2 * f.f, 0, 0, Math.PI * 2); ctx.fill();
      }
      // prospects, back to front
      const order = nodes.slice().sort((a, b) => projected.get(b.id)!.z - projected.get(a.id)!.z);
      for (const n of order) {
        const q = projected.get(n.id)!; if (q.r <= .2) continue;
        const on = matches(n.lead), isFocus = n.id === focus;
        ctx.globalAlpha = on ? 1 : .18; ctx.fillStyle = tierColor(n.lead.tier);
        ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = colors.card; ctx.lineWidth = 1.5; ctx.stroke();
        if (isFocus || st.highlight.includes(n.id)) { ctx.globalAlpha = 1; ctx.strokeStyle = colors.ink; ctx.lineWidth = isFocus ? 2 : 1.5; ctx.beginPath(); ctx.arc(q.x, q.y, q.r + 4, 0, Math.PI * 2); ctx.stroke(); }
        if (n.id === st.pinned) { const k = ((t - st.pinnedAt) / 1400) % 1; ctx.globalAlpha = .55 * (1 - k); ctx.strokeStyle = colors.ink; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(q.x, q.y, q.r + 4 + k * 22, 0, Math.PI * 2); ctx.stroke(); }
        if (st.busy.includes(n.id)) { const k = (t / 900) % 1; ctx.globalAlpha = 1 - k; ctx.strokeStyle = colors.ink; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(q.x, q.y, q.r + 4 + k * 14, 0, Math.PI * 2); ctx.stroke(); }
      }
      // labels, highest score first, skipping collisions
      const placed: { x: number; y: number; w: number }[] = [];
      const fits = (x: number, y: number, tw: number) => placed.every(r => x + tw + 4 < r.x || x - 4 > r.x + r.w || Math.abs(y - r.y) > 14);
      const rank = (n: Node) => (n.id === focus ? 2 : st.highlight.includes(n.id) ? 1 : 0);
      const labelOrder = nodes.slice().sort((a, b) => rank(b) - rank(a) || b.lead.score - a.lead.score);
      for (const n of labelOrder) {
        const q = projected.get(n.id)!; if (q.r <= .2 || (!matches(n.lead) && n.id !== focus)) continue;
        const isFocus = n.id === focus || st.highlight.includes(n.id);
        ctx.font = `${isFocus || n.lead.tier === 'Hot' ? 600 : 400} ${isFocus ? 13 : 11.5}px ${FONT}`;
        const tw = ctx.measureText(n.lead.company.name).width, lx = q.x + q.r + 6;
        if (!isFocus && !fits(lx, q.y, tw)) continue;
        placed.push({ x: lx, y: q.y, w: tw });
        ctx.globalAlpha = isFocus ? 1 : n.lead.tier === 'Hot' ? .95 : .7; ctx.textAlign = 'left';
        ctx.fillStyle = isFocus || n.lead.tier === 'Hot' ? colors.ink : colors.ink2;
        ctx.fillText(n.lead.company.name, lx, q.y);
      }
      // pinned node: place its card beside it and draw the leader line
      const card = cardRef.current, pq = st.pinned ? projected.get(st.pinned) : undefined;
      if (card && pq) {
        ctx.font = `600 13px ${FONT}`;
        const labelW = ctx.measureText(st.nodes.get(st.pinned!)?.lead.company.name ?? '').width;
        const cw = card.offsetWidth, chh = card.offsetHeight, gap = 22, rgap = labelW + 30;
        const right = pq.x + pq.r + rgap + cw <= w - 12 || pq.x - pq.r - gap - cw < 12;
        const x = right ? Math.min(pq.x + pq.r + rgap, w - cw - 12) : pq.x - pq.r - gap - cw;
        const y = Math.max(12, Math.min(h - chh - 12, pq.y - 46));
        card.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`; card.dataset.side = right ? 'right' : 'left'; card.style.visibility = 'visible';
        const grow = Math.min(1, (t - st.pinnedAt) / 260);
        const ex = right ? x : x + cw, ey = Math.max(y + 18, Math.min(y + chh - 18, pq.y));
        const sx = pq.x + (right ? pq.r + 3 : -pq.r - 3);
        ctx.globalAlpha = .9; ctx.strokeStyle = colors.ink; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(sx, pq.y); ctx.lineTo(sx + (ex - sx) * grow, pq.y + (ey - pq.y) * grow); ctx.stroke();
        ctx.fillStyle = colors.ink; ctx.beginPath(); ctx.arc(ex, ey, grow >= 1 ? 3 : 0, 0, Math.PI * 2); ctx.fill();
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
      if (d && d.moved < 6) { const { x, y } = local(e); const id = pick(x, y); st.setPinned(id); }
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

  const zoom = (k: number) => { state.current.zoom = k === 0 ? 1 : Math.max(.6, Math.min(2.4, state.current.zoom * k)); if (k === 0) { state.current.yaw = -.62; state.current.pitch = -.38; } };
  const tiers = (t: Lead['tier']) => leads.filter(l => l.tier === t).length;

  return (
    <div className="cx-brain">
      <canvas ref={canvasRef} role="img" aria-label={`3D prospect map of ${leads.length} accounts: hiring on X, score on Y, capital and momentum on Z. ${tiers('Hot')} hot accounts. Use the Accounts tab for a list.`} />
      <div className="cx-brain-title">
        <h2>Prospect Brain</h2>
        <p>X is hiring, Y is the overall score, Z is capital and momentum. Top right and front is where to act first. Drag to rotate, click any account for details.</p>
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
      {(() => {
        const lead = pinned ? leads.find(l => l.id === pinned) : undefined;
        if (!lead) return null;
        const intel = accountIntel(lead);
        const next = lead.stage === 'drafted' ? lead.sequence[0] : lead.sequence.find(t => t.day > 0);
        return (
          <div ref={cardRef} className="cx-node-card" style={{ visibility: 'hidden' }} role="dialog" aria-label={`${lead.company.name} details`}>
            <div className="cx-node-inner" key={lead.id}>
              <header>
                <div><b>{lead.company.name}</b><span>{lead.company.ticker} · {lead.company.hq}</span></div>
                <div className="sc"><b>{lead.score}</b><span className={`cx-tier ${lead.tier.toLowerCase()}`}>{lead.tier}</span></div>
                <button type="button" className="x" aria-label="Close details" onClick={() => setPinned(null)}>×</button>
              </header>
              <p className="why">{lead.why}</p>
              <ul className="sig">
                {(['hiring', 'raising', 'spending', 'news'] as SignalKind[]).map((k, i) => {
                  const s = lead.signals.find(x => x.kind === k);
                  return <li key={k} style={{ animationDelay: `${120 + i * 50}ms` }}><span>{KIND_LABEL[k]}</span><i><em style={{ width: `${s ? Math.round(s.strength / SIGNAL_MAX[k] * 100) : 0}%`, animationDelay: `${180 + i * 50}ms` }} /></i><b>{s ? s.metric : '—'}</b></li>;
                })}
              </ul>
              <dl>
                <div><dt>Est. deal</dt><dd>{intel.dealSize}</dd></div>
                <div><dt>Window</dt><dd>{intel.window}</dd></div>
                <div><dt>Buyer</dt><dd>{lead.buyer.name ? `${lead.buyer.name}, ${lead.buyer.title || lead.buyer.persona}` : lead.buyer.persona}</dd></div>
                <div><dt>Stage</dt><dd>{STAGE_LABEL[lead.stage]}</dd></div>
                <div><dt>Next step</dt><dd>{next ? `${next.channel} · ${next.due}` : 'Follow up'}</dd></div>
                <div><dt>Play</dt><dd>{intel.play.name}</dd></div>
              </dl>
              <button type="button" className="open" onClick={() => onSelect(lead.id)}>Open full profile</button>
            </div>
          </div>
        );
      })()}
      {hoverLead && !pinned ? (
        <div className="cx-brain-tip" aria-hidden="true">
          <b>{hoverLead.company.name}</b><span>{hoverLead.company.ticker} · score {hoverLead.score} · {hoverLead.tier}</span><small>{hoverLead.why}</small>
        </div>
      ) : null}
      {!leads.length ? <div className="cx-brain-empty">{running ? 'Mapping your territory…' : 'Run Outbound to map your territory'}</div> : null}
    </div>
  );
}
