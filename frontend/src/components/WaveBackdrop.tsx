'use client';

import { useEffect, useRef } from 'react';

/**
 * Hero backdrop — a first-person flight THROUGH the solar system. A warp
 * starfield streams past the camera while planets approach from the depths of
 * the centre, grow as they near, then fan off to the left or right (or drift up
 * past a passing cluster of meteorites) and out of view — one after another, on
 * to the next world. Procedurally rendered (shaded spheres, rings, bands, glow,
 * stars, rocks) on a <canvas> + requestAnimationFrame loop, so it is NOT
 * silenced by `prefers-reduced-motion` and animates on load for everyone.
 * On-brand with the site's deep-space aesthetic. DPR-aware; pauses when hidden.
 *
 * (Name kept as WaveBackdrop so the single hero import site doesn't churn.)
 */

type RGB = [number, number, number];
const rgba = ([r, g, b]: RGB, a: number) => `rgba(${r},${g},${b},${a})`;

interface PlanetKind {
  base: RGB;
  light: RGB;
  glow: RGB;
  bands?: boolean;
  rings?: RGB; // ring colour when present
}
const KINDS: PlanetKind[] = [
  { base: [42, 108, 176], light: [120, 196, 240], glow: [90, 170, 255] }, // ocean world
  { base: [176, 82, 46], light: [230, 150, 96], glow: [255, 130, 80] }, // mars-red
  { base: [201, 160, 106], light: [240, 214, 160], glow: [255, 220, 150], bands: true }, // jupiter
  { base: [216, 195, 138], light: [245, 232, 186], glow: [255, 235, 170], rings: [220, 205, 160] }, // saturn
  { base: [127, 184, 200], light: [207, 234, 240], glow: [150, 220, 240] }, // ice giant
  { base: [122, 90, 168], light: [186, 154, 216], glow: [170, 130, 230], bands: true }, // violet gas
  { base: [90, 150, 110], light: [170, 220, 180], glow: [120, 210, 150] }, // verdant
];

interface Planet {
  t: number; // 0 far/centre → 1 near/off-edge
  spd: number;
  side: -1 | 1;
  vert: number; // vertical drift factor (some pass high/low)
  maxR: number;
  kind: PlanetKind;
  ringTilt: number;
  seed: number;
}

interface Star { x: number; y: number; z: number; pz: number }
interface Rock { x: number; y: number; vx: number; vy: number; r: number; life: number; max: number }

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

    // ── Starfield ──
    const STARS = 240;
    const stars: Star[] = Array.from({ length: STARS }, () => ({
      x: (Math.random() * 2 - 1),
      y: (Math.random() * 2 - 1),
      z: Math.random(),
      pz: 0,
    }));

    // ── Planets (a rolling queue; spawn the next as the current sails past) ──
    const planets: Planet[] = [];
    let kindIdx = Math.floor(Math.random() * KINDS.length);
    let nextSide: -1 | 1 = Math.random() < 0.5 ? -1 : 1;
    const spawnPlanet = () => {
      const kind = KINDS[kindIdx % KINDS.length];
      kindIdx += 1;
      const p: Planet = {
        t: 0,
        spd: 0.0016 + Math.random() * 0.0012,
        side: nextSide,
        vert: (Math.random() * 2 - 1) * 0.5,
        maxR: Math.min(width, height) * (0.42 + Math.random() * 0.3),
        kind,
        ringTilt: -0.5 + Math.random() * 0.3,
        seed: Math.random() * 1000,
      };
      nextSide = (Math.random() < 0.5 ? -1 : 1);
      planets.push(p);
    };

    // ── Meteor clusters (occasional) ──
    const rocks: Rock[] = [];
    let meteorTimer = 4000 + Math.random() * 6000;
    const burstMeteors = () => {
      const fromLeft = Math.random() < 0.5;
      const ox = fromLeft ? -40 : width + 40;
      const oy = height * (0.1 + Math.random() * 0.5);
      const baseVx = (fromLeft ? 1 : -1) * (3 + Math.random() * 2);
      const baseVy = 1.4 + Math.random() * 1.6;
      const n = 9 + Math.floor(Math.random() * 8);
      for (let i = 0; i < n; i++) {
        rocks.push({
          x: ox + (Math.random() * 2 - 1) * 120,
          y: oy + (Math.random() * 2 - 1) * 120,
          vx: baseVx * (0.8 + Math.random() * 0.5),
          vy: baseVy * (0.8 + Math.random() * 0.5),
          r: 2 + Math.random() * 7,
          life: 0,
          max: 120 + Math.random() * 120,
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

    // ── Planet rendering ──
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
      halo.addColorStop(0, rgba(k.glow, 0.32 * fade));
      halo.addColorStop(1, rgba(k.glow, 0));
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(x, y, r * 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';

      // Rings (back half) — drawn before the body so the planet occludes it
      if (k.rings) drawRing(x, y, r, p.ringTilt, k.rings, fade, 'back');

      // Body — shaded sphere, light from upper-left
      const lx = x - r * 0.42;
      const ly = y - r * 0.42;
      const body = ctx.createRadialGradient(lx, ly, r * 0.08, x, y, r * 1.08);
      body.addColorStop(0, rgba(k.light, fade));
      body.addColorStop(0.55, rgba(k.base, fade));
      body.addColorStop(1, rgba([k.base[0] * 0.22, k.base[1] * 0.22, k.base[2] * 0.28] as RGB, fade));
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = body;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);

      // Bands for gas giants
      if (k.bands) {
        const nb = 7;
        for (let i = 0; i < nb; i++) {
          const yy = y - r + (i + 0.5) * (2 * r / nb) + Math.sin(p.seed + i) * r * 0.04;
          const shade = i % 2 === 0 ? rgba([255, 255, 255], 0.07 * fade) : rgba([0, 0, 0], 0.1 * fade);
          ctx.fillStyle = shade;
          ctx.fillRect(x - r, yy - r / nb, r * 2, (2 * r / nb) * 0.82);
        }
      }
      // Soft terminator (dark crescent on the lower-right)
      const term = ctx.createRadialGradient(x + r * 0.5, y + r * 0.5, r * 0.2, x, y, r * 1.15);
      term.addColorStop(0, rgba([0, 0, 0], 0));
      term.addColorStop(1, rgba([0, 0, 0], 0.5 * fade));
      ctx.fillStyle = term;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
      ctx.restore();

      // Rim light
      ctx.strokeStyle = rgba(k.light, 0.25 * fade);
      ctx.lineWidth = Math.max(1, r * 0.02);
      ctx.beginPath();
      ctx.arc(x, y, r * 0.99, Math.PI * 0.9, Math.PI * 1.7);
      ctx.stroke();

      // Rings (front half)
      if (k.rings) drawRing(x, y, r, p.ringTilt, k.rings, fade, 'front');
    };

    const drawRing = (x: number, y: number, r: number, tilt: number, col: RGB, fade: number, half: 'back' | 'front') => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(tilt);
      ctx.scale(1, 0.32);
      if (half === 'front') {
        // clip to the near (lower) half in ring-space
        ctx.beginPath();
        ctx.rect(-r * 3, 0, r * 6, r * 3);
        ctx.clip();
      } else {
        ctx.beginPath();
        ctx.rect(-r * 3, -r * 3, r * 6, r * 3);
        ctx.clip();
      }
      const ring = ctx.createRadialGradient(0, 0, r * 1.25, 0, 0, r * 1.95);
      ring.addColorStop(0, rgba(col, 0));
      ring.addColorStop(0.4, rgba(col, 0.5 * fade));
      ring.addColorStop(0.75, rgba(col, 0.28 * fade));
      ring.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = ring;
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.95, 0, Math.PI * 2);
      ctx.arc(0, 0, r * 1.2, 0, Math.PI * 2, true);
      ctx.fill('evenodd');
      ctx.restore();
    };

    let raf = 0;
    let running = true;
    let last = 0;

    const frame = (t: number) => {
      if (!running) return;
      const dt = last ? Math.min((t - last) / 16.67, 3) : 1;
      last = t;

      // Deep-space backdrop + nebula
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

      // Starfield warp
      const sscale = Math.min(width, height) * 0.9;
      for (const s of stars) {
        s.pz = s.z;
        s.z -= 0.0042 * dt;
        if (s.z <= 0.02) {
          s.x = Math.random() * 2 - 1;
          s.y = Math.random() * 2 - 1;
          s.z = 1;
          s.pz = 1;
        }
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

      // Planets — far first
      for (let i = planets.length - 1; i >= 0; i--) {
        const p = planets[i];
        p.t += p.spd * dt;
        if (p.t >= 1) planets.splice(i, 1);
      }
      // Spawn the next world once the leader has sailed past the midpoint.
      if (planets.length === 0 || planets[planets.length - 1].t > 0.5) {
        if (planets.length < 2) spawnPlanet();
      }
      [...planets].sort((a, b) => a.t - b.t).forEach(drawPlanet);

      // Meteor clusters
      meteorTimer -= dt * 16.67;
      if (meteorTimer <= 0) {
        burstMeteors();
        meteorTimer = 9000 + Math.random() * 9000;
      }
      ctx.globalCompositeOperation = 'lighter';
      for (let i = rocks.length - 1; i >= 0; i--) {
        const m = rocks[i];
        m.life += dt;
        m.x += m.vx * dt;
        m.y += m.vy * dt;
        if (m.life > m.max || m.x < -80 || m.x > width + 80 || m.y > height + 80) {
          rocks.splice(i, 1);
          continue;
        }
        const a = Math.min(1, m.life / 12) * Math.min(1, (m.max - m.life) / 24);
        ctx.strokeStyle = `rgba(255,210,170,${0.5 * a})`;
        ctx.lineWidth = m.r * 0.7;
        ctx.beginPath();
        ctx.moveTo(m.x - m.vx * 4, m.y - m.vy * 4);
        ctx.lineTo(m.x, m.y);
        ctx.stroke();
        ctx.fillStyle = `rgba(200,180,170,${a})`;
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    const onVisibility = () => {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(raf);
      } else if (!running) {
        running = true;
        last = 0;
        raf = requestAnimationFrame(frame);
      }
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
