'use client';

import { useEffect, useRef } from 'react';

/**
 * Hero backdrop — a first-person flight THROUGH the solar system. A warp
 * starfield streams past while planets approach from the centre depths, grow,
 * spin on their own axis (a scrolling surface texture with limb foreshortening
 * gives true 3-D rotation), then fan off to the left or right and out of view —
 * on to the next world. Occasional clusters of tumbling asteroids drift past.
 *
 * Procedurally rendered on a <canvas> + requestAnimationFrame loop, so it is NOT
 * silenced by `prefers-reduced-motion`. On-brand with the site's deep-space
 * aesthetic. DPR-aware; pauses when hidden.
 *
 * (Name kept as WaveBackdrop so the single hero import site doesn't churn.)
 */

type RGB = [number, number, number];
const rgba = ([r, g, b]: RGB, a: number) => `rgba(${r},${g},${b},${a})`;
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

interface PlanetKind {
  base: RGB;
  light: RGB;
  glow: RGB;
  bands?: boolean;
  rings?: RGB;
}
const KINDS: PlanetKind[] = [
  { base: [42, 108, 176], light: [125, 200, 242], glow: [90, 170, 255] }, // ocean world
  { base: [176, 82, 46], light: [232, 152, 98], glow: [255, 130, 80] }, // mars-red
  { base: [201, 160, 106], light: [242, 216, 162], glow: [255, 220, 150], bands: true }, // jupiter
  { base: [214, 193, 138], light: [245, 232, 188], glow: [255, 235, 170], rings: [222, 207, 162] }, // saturn
  { base: [127, 184, 200], light: [210, 236, 242], glow: [150, 220, 240] }, // ice giant
  { base: [122, 90, 168], light: [190, 158, 220], glow: [170, 130, 230], bands: true }, // violet gas
  { base: [88, 150, 110], light: [172, 222, 182], glow: [120, 210, 150] }, // verdant
];

interface Planet {
  t: number;
  spd: number;
  side: -1 | 1;
  vert: number;
  maxR: number;
  kind: PlanetKind;
  ringTilt: number;
  tex: HTMLCanvasElement;
  rot: number;
  rotSpeed: number;
  axis: number; // axial tilt
}
interface Star { x: number; y: number; z: number; pz: number }
interface Rock {
  x: number; y: number; vx: number; vy: number; size: number;
  verts: number[]; rot: number; spin: number; life: number; max: number; shade: number;
}

/** Build a seamless (x-wrapping) equirectangular surface texture for a planet. */
function genTexture(k: PlanetKind): HTMLCanvasElement {
  const tw = 256;
  const th = 128;
  const c = document.createElement('canvas');
  c.width = tw;
  c.height = th;
  const g = c.getContext('2d')!;
  g.fillStyle = rgba(k.base, 1);
  g.fillRect(0, 0, tw, th);

  // Soft (optionally elongated) blob, wrapped in x so the texture tiles seamlessly.
  const blobE = (x: number, y: number, rx: number, ry: number, col: RGB, a: number) => {
    for (const ox of [-tw, 0, tw]) {
      g.save();
      g.translate(x + ox, y);
      g.scale(1, ry / Math.max(1, rx));
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, rx);
      gr.addColorStop(0, rgba(col, a));
      gr.addColorStop(1, rgba(col, 0));
      g.fillStyle = gr;
      g.beginPath();
      g.arc(0, 0, rx, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
  };

  if (k.bands) {
    // Turbulent latitudinal bands — rows of horizontally-smeared soft blobs at
    // LOW contrast, so it reads like a gas giant (Jupiter), not a beach ball.
    const rows = 13;
    for (let i = 0; i < rows; i++) {
      const yy = ((i + 0.5) / rows) * th;
      const tone = i % 2 ? mix(k.base, k.light, 0.32) : mix(k.base, [0, 0, 0], 0.22);
      for (let j = 0; j < 5; j++) {
        const bx = (j / 5) * tw + Math.random() * 50;
        const wy = yy + Math.sin(j * 1.7 + i) * (th / rows) * 0.18;
        blobE(bx, wy, 34 + Math.random() * 40, 4 + Math.random() * 4, tone, 0.3);
      }
    }
    blobE(tw * 0.62, th * 0.58, 24, 13, mix(k.light, [255, 255, 255], 0.25), 0.55); // great spot
  } else {
    const dark = mix(k.base, [0, 0, 0], 0.42);
    for (let i = 0; i < 16; i++) {
      const bx = Math.random() * tw;
      const by = 14 + Math.random() * (th - 28);
      const r = 9 + Math.random() * 22;
      blobE(bx, by, r, r * (0.7 + Math.random() * 0.5), Math.random() < 0.55 ? k.light : dark, 0.42 + Math.random() * 0.25);
    }
  }
  // fine speckle for texture (kept within bounds so the wrap stays seamless)
  for (let i = 0; i < 200; i++) {
    g.fillStyle = rgba(Math.random() < 0.5 ? k.light : [0, 0, 0], 0.04);
    g.fillRect(4 + Math.random() * (tw - 8), Math.random() * th, 2, 2);
  }
  return c;
}

export default function WaveBackdrop({ className = '' }: { className?: string }) {
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

    const STARS = 240;
    const stars: Star[] = Array.from({ length: STARS }, () => ({ x: Math.random() * 2 - 1, y: Math.random() * 2 - 1, z: Math.random(), pz: 0 }));

    const planets: Planet[] = [];
    let kindIdx = Math.floor(Math.random() * KINDS.length);
    let nextSide: -1 | 1 = Math.random() < 0.5 ? -1 : 1;
    const spawnPlanet = () => {
      const kind = KINDS[kindIdx % KINDS.length];
      kindIdx += 1;
      planets.push({
        t: 0,
        spd: 0.0015 + Math.random() * 0.001,
        side: nextSide,
        vert: (Math.random() * 2 - 1) * 0.5,
        maxR: Math.min(width, height) * (0.42 + Math.random() * 0.3),
        kind,
        ringTilt: -0.5 + Math.random() * 0.3,
        tex: genTexture(kind),
        rot: Math.random() * Math.PI * 2,
        rotSpeed: (0.004 + Math.random() * 0.006) * (Math.random() < 0.5 ? 1 : -1),
        axis: (Math.random() * 2 - 1) * 0.25,
      });
      nextSide = Math.random() < 0.5 ? -1 : 1;
    };

    const rocks: Rock[] = [];
    let meteorTimer = 3500 + Math.random() * 5000;
    const burstMeteors = () => {
      const fromLeft = Math.random() < 0.5;
      const ox = fromLeft ? -60 : width + 60;
      const oy = height * (0.12 + Math.random() * 0.5);
      const baseVx = (fromLeft ? 1 : -1) * (1.8 + Math.random() * 1.4);
      const baseVy = 0.7 + Math.random() * 1.1;
      const n = 8 + Math.floor(Math.random() * 7);
      for (let i = 0; i < n; i++) {
        const verts: number[] = [];
        const vn = 7 + Math.floor(Math.random() * 4);
        for (let v = 0; v < vn; v++) verts.push(0.62 + Math.random() * 0.42);
        rocks.push({
          x: ox + (Math.random() * 2 - 1) * 150,
          y: oy + (Math.random() * 2 - 1) * 150,
          vx: baseVx * (0.8 + Math.random() * 0.5),
          vy: baseVy * (0.7 + Math.random() * 0.7),
          size: 4 + Math.random() * 14,
          verts,
          rot: Math.random() * Math.PI * 2,
          spin: (Math.random() * 2 - 1) * 0.04,
          life: 0,
          max: 240 + Math.random() * 200,
          shade: 0.55 + Math.random() * 0.3,
        });
      }
    };

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = host.clientWidth;
      height = host.clientHeight;
      cx = width / 2;
      cy = height * 0.46;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      for (const p of planets) p.maxR = Math.min(width, height) * 0.55;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    if (planets.length === 0) spawnPlanet();

    const drawRing = (x: number, y: number, r: number, tilt: number, col: RGB, fade: number, half: 'back' | 'front') => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(tilt);
      ctx.scale(1, 0.3);
      ctx.beginPath();
      if (half === 'front') ctx.rect(-r * 3, 0, r * 6, r * 3);
      else ctx.rect(-r * 3, -r * 3, r * 6, r * 3);
      ctx.clip();
      const ring = ctx.createRadialGradient(0, 0, r * 1.22, 0, 0, r * 1.95);
      ring.addColorStop(0, rgba(col, 0));
      ring.addColorStop(0.4, rgba(col, 0.55 * fade));
      ring.addColorStop(0.72, rgba(col, 0.3 * fade));
      ring.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = ring;
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.95, 0, Math.PI * 2);
      ctx.arc(0, 0, r * 1.18, 0, Math.PI * 2, true);
      ctx.fill('evenodd');
      ctx.restore();
    };

    const drawPlanet = (p: Planet) => {
      const e = Math.pow(p.t, 1.8);
      const swing = Math.pow(p.t, 2.5);
      const x = cx + p.side * width * 0.92 * swing;
      const y = cy + p.vert * height * 0.5 * Math.pow(p.t, 1.7) - height * 0.04 * p.t;
      const r = 3 + p.maxR * e;
      if (r < 1) return;
      const fade = Math.min(p.t * 8, 1);
      const k = p.kind;

      // Atmosphere glow
      ctx.globalCompositeOperation = 'lighter';
      const halo = ctx.createRadialGradient(x, y, r * 0.85, x, y, r * 1.5);
      halo.addColorStop(0, rgba(k.glow, 0.3 * fade));
      halo.addColorStop(1, rgba(k.glow, 0));
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(x, y, r * 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';

      if (k.rings) drawRing(x, y, r, p.ringTilt, k.rings, fade, 'back');

      // ── Rotating sphere surface ──
      const tex = p.tex;
      const tw = tex.width;
      const th = tex.height;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(p.axis);
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.clip();
      ctx.globalAlpha = fade;
      const step = Math.max(2, r / 80);
      // Draw the sphere as vertical texture slices. Destination columns are
      // snapped to integer pixels and overlapped by 1px so no sub-pixel seam
      // can let the dark space background bleed through between columns — that
      // gap was the faint vertical "black line" on the planet's terminator. The
      // source x is clamped to the texture's last column so a slice at the
      // longitude wrap never samples past the edge into nothing.
      for (let xs = -r; xs < r; xs += step) {
        const f = Math.max(-1, Math.min(1, xs / r));
        const lon = Math.asin(f) + p.rot; // limb foreshortening via asin
        const u = (((lon / (Math.PI * 2)) % 1) + 1) % 1;
        const sx = Math.min(u * tw, tw - 1);
        const ch = Math.sqrt(Math.max(0, r * r - xs * xs));
        const dx = Math.floor(xs);
        const dw = Math.ceil(step) + 1;
        ctx.drawImage(tex, sx, 0, 1, th, dx, -ch, dw, ch * 2);
      }
      ctx.globalAlpha = 1;
      // Specular highlight (upper-left) + terminator shadow (lower-right) for 3-D
      const hl = ctx.createRadialGradient(-r * 0.4, -r * 0.4, r * 0.05, -r * 0.4, -r * 0.4, r * 1.1);
      hl.addColorStop(0, rgba([255, 255, 255], 0.28 * fade));
      hl.addColorStop(0.5, rgba([255, 255, 255], 0));
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = hl;
      ctx.fillRect(-r, -r, r * 2, r * 2);
      ctx.globalCompositeOperation = 'source-over';
      const term = ctx.createRadialGradient(r * 0.4, r * 0.4, r * 0.15, 0, 0, r * 1.3);
      term.addColorStop(0, rgba([0, 0, 0], 0));
      term.addColorStop(0.55, rgba([3, 6, 16], 0.18 * fade));
      term.addColorStop(1, rgba([3, 6, 16], 0.66 * fade));
      ctx.fillStyle = term;
      ctx.fillRect(-r, -r, r * 2, r * 2);
      ctx.restore();

      // Rim light
      ctx.strokeStyle = rgba(k.light, 0.22 * fade);
      ctx.lineWidth = Math.max(1, r * 0.02);
      ctx.beginPath();
      ctx.arc(x, y, r * 0.99, Math.PI * 0.85, Math.PI * 1.7);
      ctx.stroke();

      if (k.rings) drawRing(x, y, r, p.ringTilt, k.rings, fade, 'front');
    };

    let raf = 0;
    let running = true;
    let last = 0;

    const frame = (t: number) => {
      if (!running) return;
      const dt = last ? Math.min((t - last) / 16.67, 3) : 1;
      last = t;

      const bg = ctx.createLinearGradient(0, 0, 0, height);
      bg.addColorStop(0, '#05080f');
      bg.addColorStop(1, '#0a0e1a');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = 'lighter';
      const neb = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(width, height) * 0.6);
      neb.addColorStop(0, 'rgba(60,90,180,0.16)');
      neb.addColorStop(0.5, 'rgba(120,60,170,0.07)');
      neb.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = neb;
      ctx.fillRect(0, 0, width, height);

      // Warp starfield
      const sscale = Math.min(width, height) * 0.9;
      for (const s of stars) {
        s.pz = s.z;
        s.z -= 0.0042 * dt;
        if (s.z <= 0.02) { s.x = Math.random() * 2 - 1; s.y = Math.random() * 2 - 1; s.z = 1; s.pz = 1; }
        const sx = cx + (s.x / s.z) * sscale;
        const sy = cy + (s.y / s.z) * sscale;
        if (sx < 0 || sx > width || sy < 0 || sy > height) continue;
        const px = cx + (s.x / s.pz) * sscale;
        const py = cy + (s.y / s.pz) * sscale;
        const b = Math.min(1, (1 - s.z) * 1.4);
        ctx.strokeStyle = `rgba(${200 + b * 55},${215 + b * 40},255,${0.25 + b * 0.7})`;
        ctx.lineWidth = (1 - s.z) * 2.2;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(sx, sy);
        ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';

      for (let i = planets.length - 1; i >= 0; i--) {
        planets[i].t += planets[i].spd * dt;
        planets[i].rot += planets[i].rotSpeed * dt;
        if (planets[i].t >= 1) planets.splice(i, 1);
      }
      if ((planets.length === 0 || planets[planets.length - 1].t > 0.5) && planets.length < 2) spawnPlanet();
      [...planets].sort((a, b) => a.t - b.t).forEach(drawPlanet);

      // Tumbling asteroid clusters
      meteorTimer -= dt * 16.67;
      if (meteorTimer <= 0) { burstMeteors(); meteorTimer = 9000 + Math.random() * 9000; }
      for (let i = rocks.length - 1; i >= 0; i--) {
        const m = rocks[i];
        m.life += dt;
        m.x += m.vx * dt;
        m.y += m.vy * dt;
        m.rot += m.spin * dt;
        if (m.life > m.max || m.x < -120 || m.x > width + 120 || m.y > height + 120) { rocks.splice(i, 1); continue; }
        const a = Math.min(1, m.life / 16) * Math.min(1, (m.max - m.life) / 30);
        ctx.save();
        ctx.translate(m.x, m.y);
        ctx.rotate(m.rot);
        ctx.beginPath();
        const n = m.verts.length;
        for (let v = 0; v < n; v++) {
          const ang = (v / n) * Math.PI * 2;
          const rr = m.size * m.verts[v];
          const px = Math.cos(ang) * rr;
          const py = Math.sin(ang) * rr;
          if (v === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        const g = Math.round(120 * m.shade);
        const grad = ctx.createLinearGradient(-m.size, -m.size, m.size, m.size);
        grad.addColorStop(0, `rgba(${g + 60},${g + 52},${g + 46},${a})`);
        grad.addColorStop(1, `rgba(${g - 30},${g - 34},${g - 38},${a})`);
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.strokeStyle = `rgba(30,28,26,${0.5 * a})`;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
      }

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
