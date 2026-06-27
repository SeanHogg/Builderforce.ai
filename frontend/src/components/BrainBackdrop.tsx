'use client';

import { useEffect, useRef } from 'react';

/**
 * Hero backdrop — Evermind, the platform's brain. A neural brain silhouette is
 * built from a living network of neurons; glowing packets of "information" travel
 * the synapses, lighting nodes as they arrive — the visual metaphor for
 * Write-Through Cognition (knowledge flows through and updates the model in place).
 *
 * A handful of larger HUB neurons stand for the platform's key aspects (the
 * Evermind generator + write-through memory + limbic dynamics, plus the agentic
 * workforce, governance, and the board). Signals route hub→hub through the mesh,
 * so the brain reads as one system where every part feeds every other.
 *
 * Procedurally rendered on a <canvas> + requestAnimationFrame loop, so it is NOT
 * silenced by `prefers-reduced-motion`. On-brand with the site's deep-space
 * aesthetic. DPR-aware; pauses when hidden.
 *
 * (Replaces the former solar-system WaveBackdrop; keeps the same .wb-* scene
 * classes so the single hero import site and globals.css don't churn.)
 */

type RGB = [number, number, number];
const rgba = ([r, g, b]: RGB, a: number) => `rgba(${r},${g},${b},${a})`;
const mix = (a: RGB, b: RGB, t: number): RGB => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];

// Brand accents (coral-bright is blue #4d9eff, cyan-bright is teal #00e5cc).
const BLUE: RGB = [77, 158, 255];
const CYAN: RGB = [0, 229, 204];
const VIOLET: RGB = [150, 120, 240];

interface Node {
  x: number;
  y: number;
  r: number;
  hub: boolean;
  color: RGB;
  act: number; // activation 0..1 — decays; spikes when a signal arrives
}
interface Edge {
  a: number;
  b: number;
  len: number;
}
interface Signal {
  edge: number;
  from: number; // node index the signal is leaving
  t: number; // 0..1 along the edge
  speed: number;
  color: RGB;
  hops: number;
}

export default function BrainBackdrop({ className = '' }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let dpr = 1;
    let cx = 0;
    let cy = 0;
    let scale = 1;

    let nodes: Node[] = [];
    let edges: Edge[] = [];
    let adj: number[][] = []; // adjacency: per node, list of edge indices
    let outline: { x: number; y: number }[] = [];
    let fissure: { x: number; y: number }[] = [];
    const signals: Signal[] = [];
    const hubIdx: number[] = [];

    /** Lumpy-ellipse "cerebrum" silhouette (a cloud of gyri bumps), flatter
     *  along the bottom, with a small brain-stem nub — reads as a side-view brain
     *  once the internal neuron mesh and central fissure are drawn over it. */
    const brainRadius = (ang: number, rx: number, ry: number) => {
      // Sum of fixed-phase sines → organic, repeatable gyri lumps.
      const lump =
        1 +
        0.05 * Math.sin(ang * 7 + 0.6) +
        0.035 * Math.sin(ang * 11 - 1.2) +
        0.03 * Math.sin(ang * 4 + 2.1);
      const x = Math.cos(ang) * rx * lump;
      let y = Math.sin(ang) * ry * lump;
      // Flatten the underside (brains sit flat) and lift the frontal lobe a touch.
      if (y > 0) y *= 0.82;
      return { x, y };
    };

    const buildBrain = () => {
      const rx = scale * 1.0;
      const ry = scale * 0.78;

      // Outline polyline.
      outline = [];
      const STEPS = 220;
      for (let i = 0; i <= STEPS; i++) {
        const ang = (i / STEPS) * Math.PI * 2;
        const p = brainRadius(ang, rx, ry);
        outline.push({ x: cx + p.x, y: cy + p.y });
      }

      // Central fissure — a gently S-curved seam down the middle.
      fissure = [];
      for (let i = 0; i <= 40; i++) {
        const f = i / 40;
        const yy = -ry * 0.74 + f * ry * 1.4;
        const xx = Math.sin(f * Math.PI) * scale * 0.06 + Math.sin(f * 6) * scale * 0.02;
        fissure.push({ x: cx + xx, y: cy + yy * 0.82 });
      }

      // Rejection-sample neuron positions inside the lumpy ellipse.
      const inside = (x: number, y: number) => {
        const dx = x - cx;
        const dy = y - cy;
        const ang = Math.atan2(dy, dx);
        const p = brainRadius(ang, rx, ry);
        const rr = Math.hypot(p.x, p.y) * 0.92; // keep nodes off the rim
        return dx * dx + dy * dy < rr * rr;
      };

      nodes = [];
      hubIdx.length = 0;

      // Hub neurons = the platform's key aspects, placed at evocative spots
      // (frontal / temporal / parietal / occipital / core / stem regions).
      const hubs: { hx: number; hy: number; color: RGB }[] = [
        { hx: -0.55, hy: -0.18, color: CYAN }, // Evermind generator (frontal)
        { hx: 0.5, hy: -0.28, color: BLUE }, // Write-through memory
        { hx: 0.62, hy: 0.18, color: VIOLET }, // Limbic dynamics
        { hx: -0.05, hy: -0.42, color: BLUE }, // Agentic workforce (crown)
        { hx: -0.62, hy: 0.22, color: CYAN }, // Governance & audit
        { hx: 0.04, hy: 0.34, color: VIOLET }, // The board / system of record
        { hx: 0.0, hy: 0.02, color: mix(BLUE, CYAN, 0.5) }, // core
      ];
      for (const h of hubs) {
        nodes.push({
          x: cx + h.hx * rx,
          y: cy + h.hy * ry,
          r: scale * 0.028,
          hub: true,
          color: h.color,
          act: 0,
        });
        hubIdx.push(nodes.length - 1);
      }

      // Supporting neurons.
      const target = 64;
      let guard = 0;
      while (nodes.length < target && guard < target * 40) {
        guard++;
        const x = cx + (Math.random() * 2 - 1) * rx;
        const y = cy + (Math.random() * 2 - 1) * ry;
        if (!inside(x, y)) continue;
        // Reject if too close to an existing node (even spread).
        let ok = true;
        for (const n of nodes) {
          if (Math.hypot(n.x - x, n.y - y) < scale * 0.11) { ok = false; break; }
        }
        if (!ok) continue;
        nodes.push({
          x,
          y,
          r: scale * (0.008 + Math.random() * 0.008),
          hub: false,
          color: mix(BLUE, CYAN, Math.random()),
          act: 0,
        });
      }

      // Connect each node to its nearest neighbours → synapse mesh.
      edges = [];
      adj = nodes.map(() => []);
      const maxLen = scale * 0.34;
      for (let i = 0; i < nodes.length; i++) {
        const dists = nodes
          .map((n, j) => ({ j, d: Math.hypot(n.x - nodes[i].x, n.y - nodes[i].y) }))
          .filter((o) => o.j !== i)
          .sort((p, q) => p.d - q.d);
        const k = nodes[i].hub ? 5 : 3;
        for (let m = 0; m < Math.min(k, dists.length); m++) {
          const { j, d } = dists[m];
          if (d > maxLen) continue;
          if (edges.some((e) => (e.a === i && e.b === j) || (e.a === j && e.b === i))) continue;
          const ei = edges.length;
          edges.push({ a: i, b: j, len: d });
          adj[i].push(ei);
          adj[j].push(ei);
        }
      }
    };

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = host.clientWidth;
      height = host.clientHeight;
      cx = width / 2;
      cy = height * 0.46;
      scale = Math.min(width * 0.42, height * 0.62);
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      buildBrain();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    /** Launch a packet of information from a hub, routed along a random synapse. */
    const emitSignal = (fromNode?: number) => {
      const start = fromNode ?? hubIdx[Math.floor(Math.random() * hubIdx.length)];
      const out = adj[start];
      if (!out || out.length === 0) return;
      const edge = out[Math.floor(Math.random() * out.length)];
      const color = nodes[start].color;
      signals.push({ edge, from: start, t: 0, speed: 0.9 + Math.random() * 0.8, color, hops: 0 });
    };

    let emitTimer = 0;

    const drawNeuronMesh = (t: number) => {
      // Synapses — faint static lines, brighter when either endpoint is active.
      for (const e of edges) {
        const na = nodes[e.a];
        const nb = nodes[e.b];
        const a = 0.06 + Math.max(na.act, nb.act) * 0.5;
        ctx.strokeStyle = rgba(mix(na.color, nb.color, 0.5), a);
        ctx.lineWidth = 0.6 + Math.max(na.act, nb.act) * 1.2;
        ctx.beginPath();
        ctx.moveTo(na.x, na.y);
        ctx.lineTo(nb.x, nb.y);
        ctx.stroke();
      }

      // Neurons.
      ctx.globalCompositeOperation = 'lighter';
      for (const n of nodes) {
        const pulse = n.hub ? 0.5 + 0.5 * Math.sin(t * 0.002 + n.x * 0.02) : 0;
        const glow = n.r * (n.hub ? 4.5 : 3) * (1 + n.act * 1.4 + pulse * 0.4);
        const halo = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, glow);
        halo.addColorStop(0, rgba(n.color, (n.hub ? 0.5 : 0.32) + n.act * 0.5));
        halo.addColorStop(1, rgba(n.color, 0));
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(n.x, n.y, glow, 0, Math.PI * 2);
        ctx.fill();
      }
      // Bright cores.
      for (const n of nodes) {
        ctx.fillStyle = rgba(mix(n.color, [255, 255, 255], 0.4 + n.act * 0.4), 0.9);
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r * (1 + n.act * 0.8), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    };

    let raf = 0;
    let running = true;
    let last = 0;

    const frame = (t: number) => {
      if (!running) return;
      const dt = last ? Math.min((t - last) / 16.67, 3) : 1;
      last = t;

      // Background — deep-space gradient (shared with the rest of the site hero).
      const bg = ctx.createLinearGradient(0, 0, 0, height);
      bg.addColorStop(0, '#05080f');
      bg.addColorStop(1, '#0a0e1a');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = 'lighter';
      const neb = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(width, height) * 0.55);
      neb.addColorStop(0, 'rgba(40,90,180,0.16)');
      neb.addColorStop(0.5, 'rgba(0,160,150,0.06)');
      neb.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = neb;
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = 'source-over';

      // Brain silhouette — soft inner mass + glowing contour + central fissure.
      const mass = ctx.createRadialGradient(cx, cy - scale * 0.1, scale * 0.1, cx, cy, scale * 1.1);
      mass.addColorStop(0, 'rgba(60,90,160,0.10)');
      mass.addColorStop(1, 'rgba(10,20,40,0)');
      ctx.fillStyle = mass;
      ctx.beginPath();
      outline.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.fill();

      ctx.save();
      ctx.shadowColor = rgba(BLUE, 0.5);
      ctx.shadowBlur = 18;
      ctx.strokeStyle = rgba(mix(BLUE, CYAN, 0.4), 0.35);
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      outline.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.stroke();
      ctx.restore();

      ctx.strokeStyle = rgba(mix(BLUE, CYAN, 0.4), 0.18);
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      fissure.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();

      // Decay node activations.
      for (const n of nodes) n.act = Math.max(0, n.act - dt * 0.03);

      // Spawn information packets from the hubs on a cadence.
      emitTimer -= dt * 16.67;
      if (emitTimer <= 0) {
        emitSignal();
        if (Math.random() < 0.5) emitSignal();
        emitTimer = 420 + Math.random() * 520;
      }

      drawNeuronMesh(t);

      // Advance + draw travelling signals.
      ctx.globalCompositeOperation = 'lighter';
      for (let i = signals.length - 1; i >= 0; i--) {
        const s = signals[i];
        const e = edges[s.edge];
        if (!e) { signals.splice(i, 1); continue; }
        const dest = s.from === e.a ? e.b : e.a;
        const src = s.from;
        s.t += (s.speed / Math.max(e.len, 1)) * dt * 3.2;

        const px = nodes[src].x + (nodes[dest].x - nodes[src].x) * Math.min(s.t, 1);
        const py = nodes[src].y + (nodes[dest].y - nodes[src].y) * Math.min(s.t, 1);

        // Comet head + short trail.
        const head = scale * 0.02;
        const g = ctx.createRadialGradient(px, py, 0, px, py, head * 2.6);
        g.addColorStop(0, rgba(mix(s.color, [255, 255, 255], 0.5), 0.95));
        g.addColorStop(1, rgba(s.color, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(px, py, head * 2.6, 0, Math.PI * 2);
        ctx.fill();

        if (s.t >= 1) {
          // Arrived — light the node, then keep routing (random walk) so the
          // information keeps flowing through the brain. Long walks die off.
          nodes[dest].act = Math.min(1, nodes[dest].act + 0.9);
          signals.splice(i, 1);
          const cont = s.hops < 6 && Math.random() < (nodes[dest].hub ? 0.95 : 0.82);
          if (cont) {
            const out = adj[dest].filter((ei) => ei !== s.edge);
            const pool = out.length ? out : adj[dest];
            if (pool.length) {
              const nextEdge = pool[Math.floor(Math.random() * pool.length)];
              signals.push({
                edge: nextEdge,
                from: dest,
                t: 0,
                speed: s.speed,
                color: nodes[dest].hub ? nodes[dest].color : s.color,
                hops: s.hops + 1,
              });
            }
          }
        }
      }
      ctx.globalCompositeOperation = 'source-over';

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    const onVisibility = () => {
      if (document.hidden) { running = false; cancelAnimationFrame(raf); }
      else if (!running) { running = true; last = 0; raf = requestAnimationFrame(frame); }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return (
    <div className={`wb-scene ${className}`} aria-hidden="true">
      <canvas ref={canvasRef} className="wb-canvas" />
      {/* Fade the foot of the scene into the page background so content blends in. */}
      <div className="wb-fade" />
    </div>
  );
}
