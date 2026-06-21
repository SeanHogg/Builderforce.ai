'use client';

import { useEffect, useRef } from 'react';

/**
 * Hero backdrop — a first-person "moving forward through a forest" parallax,
 * built as TWO layers (matching the contextqa.com hero structure):
 *
 *   1. A STATIC skyline that never moves: sky gradient + soft clouds in the open
 *      centre, a hazy distant treeline along the horizon, and big framing trees
 *      anchored at the far-left / far-right edges. Rendered once to an offscreen
 *      canvas (re-rendered only on resize / theme change / sprite load) and
 *      blitted each frame — no per-frame recompute of stable pixels.
 *   2. An ANIMATED foreground: trees that grow from the centre distance and
 *      slide OUTWARD off the far edges (perspective converging toward the
 *      vanishing point), recycling forever — the sense of driving forward.
 *
 * Driven by a <canvas> + requestAnimationFrame loop (the always-on technique
 * contextqa uses) so it is NOT silenced by `prefers-reduced-motion`. Trees are
 * real sprite images from /public/hero (procedural silhouette only as a fallback
 * until a sprite decodes). Theme-reactive, DPR-aware, pauses when hidden.
 *
 * (Name kept as WaveBackdrop so the single import site doesn't churn.)
 */

type RGB = [number, number, number];
interface Palette {
  skyTop: RGB;
  skyHorizon: RGB;
  glow: RGB; // bright open centre (kept readable behind hero text)
  cloud: RGB;
  ground: RGB;
  haze: RGB; // distant trees fade toward this (atmospheric perspective)
  tree: RGB; // procedural fallback foliage
}

const DARK: Palette = {
  skyTop: [9, 18, 40],
  skyHorizon: [26, 50, 88],
  glow: [120, 160, 220],
  cloud: [150, 178, 220],
  ground: [7, 14, 28],
  haze: [26, 50, 88],
  tree: [12, 30, 40],
};
const LIGHT: Palette = {
  skyTop: [186, 214, 240],
  skyHorizon: [247, 251, 255],
  glow: [255, 255, 255],
  cloud: [255, 255, 255],
  ground: [150, 178, 140],
  haze: [206, 224, 238],
  tree: [40, 86, 64],
};

const rgba = ([r, g, b]: RGB, a: number) => `rgba(${r},${g},${b},${a})`;
const mix = (a: RGB, b: RGB, t: number): RGB => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];
/** Deterministic pseudo-jitter in [-1, 1] from an integer seed. */
const jit = (n: number) => Math.sin(n * 12.9898) * 43758.5453 % 1;

const SPRITE_SRCS = ['/hero/tree-pine.svg', '/hero/tree-fir.svg', '/hero/tree-round.svg'];

interface Tree {
  side: -1 | 1;
  t: number; // 0 (far/centre) → 1 (near/off-edge)
  spd: number;
  endSpread: number; // how far past centre it ends (fraction of half-width)
  startJitter: number;
  maxH: number;
  sprite: number;
}

export default function WaveBackdrop({ className = '' }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Offscreen canvas for the static skyline layer.
    const bg = document.createElement('canvas');
    const bgCtx = bg.getContext('2d');
    if (!bgCtx) return;

    let width = 0;
    let height = 0;
    let dpr = 1;

    // Sprite preload — re-render the static layer once each one decodes.
    let loaded = 0;
    const sprites = SPRITE_SRCS.map((src) => {
      const im = new Image();
      im.onload = () => {
        loaded += 1;
        staticKey = '';
      };
      im.src = src;
      return im;
    });
    const ready = (im: HTMLImageElement) => im.complete && im.naturalWidth > 0;
    const palette = () => (document.documentElement.dataset.theme === 'light' ? LIGHT : DARK);

    /** Draw a conifer sprite (or procedural fallback) with base at (x, baseY). */
    const tree = (g: CanvasRenderingContext2D, idx: number, x: number, baseY: number, h: number, alpha: number, pal: Palette) => {
      const im = sprites[idx % sprites.length];
      if (ready(im)) {
        const w = h * (im.naturalWidth / im.naturalHeight);
        g.globalAlpha = alpha;
        g.drawImage(im, x - w / 2, baseY - h, w, h);
        g.globalAlpha = 1;
        return;
      }
      // Fallback silhouette
      const w = h * 0.46;
      const fy = baseY - h * 0.14;
      g.fillStyle = rgba(pal.tree, alpha);
      g.fillRect(x - h * 0.035, fy, h * 0.07, h * 0.14);
      g.beginPath();
      g.moveTo(x - w / 2, fy); g.lineTo(x + w / 2, fy); g.lineTo(x, fy - h * 0.5); g.closePath();
      g.moveTo(x - w * 0.36, fy - h * 0.3); g.lineTo(x + w * 0.36, fy - h * 0.3); g.lineTo(x, fy - h * 0.72); g.closePath();
      g.moveTo(x - w * 0.24, fy - h * 0.56); g.lineTo(x + w * 0.24, fy - h * 0.56); g.lineTo(x, fy - h); g.closePath();
      g.fill();
    };

    const softBlob = (g: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, col: RGB, a: number) => {
      const grad = g.createRadialGradient(cx, cy, 0, cx, cy, rx);
      grad.addColorStop(0, rgba(col, a));
      grad.addColorStop(1, rgba(col, 0));
      g.save();
      g.translate(cx, cy);
      g.scale(1, ry / rx);
      g.beginPath();
      g.arc(0, 0, rx, 0, Math.PI * 2);
      g.fillStyle = grad;
      g.fill();
      g.restore();
    };

    let horizonY = 0;
    let staticKey = '';
    const renderStatic = (pal: Palette) => {
      const W = width;
      const Hh = height;
      horizonY = Hh * 0.6;
      bgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      bgCtx.clearRect(0, 0, W, Hh);

      // Sky + ground
      const sky = bgCtx.createLinearGradient(0, 0, 0, horizonY);
      sky.addColorStop(0, rgba(pal.skyTop, 1));
      sky.addColorStop(1, rgba(pal.skyHorizon, 1));
      bgCtx.fillStyle = sky;
      bgCtx.fillRect(0, 0, W, horizonY);
      const grd = bgCtx.createLinearGradient(0, horizonY, 0, Hh);
      grd.addColorStop(0, rgba(pal.skyHorizon, 1));
      grd.addColorStop(1, rgba(pal.ground, 1));
      bgCtx.fillStyle = grd;
      bgCtx.fillRect(0, horizonY, W, Hh - horizonY);

      // Bright centre glow (the open "clarity" lane)
      const gl = bgCtx.createRadialGradient(W / 2, horizonY * 0.78, 0, W / 2, horizonY * 0.78, Math.max(W, Hh) * 0.5);
      gl.addColorStop(0, rgba(pal.glow, 0.7));
      gl.addColorStop(0.5, rgba(pal.glow, 0.12));
      gl.addColorStop(1, rgba(pal.glow, 0));
      bgCtx.fillStyle = gl;
      bgCtx.fillRect(0, 0, W, Hh);

      // Soft clouds clustered in the open centre sky (deterministic)
      const clouds: [number, number, number][] = [
        [0.5, 0.30, 1.3], [0.4, 0.4, 0.9], [0.6, 0.38, 1.0], [0.5, 0.5, 1.15], [0.32, 0.46, 0.7], [0.68, 0.48, 0.75],
      ];
      for (const [fx, fy, s] of clouds) {
        softBlob(bgCtx, W * fx, Hh * fy, 150 * s * (W / 1200), 52 * s * (W / 1200), pal.cloud, pal.cloud[0] > 200 ? 0.85 : 0.16);
      }

      // Hazy distant treeline along the horizon (static, atmospheric)
      const farN = Math.max(22, Math.round(W / 46));
      const farColor = mix(pal.haze, pal.tree, 0.5);
      for (let i = 0; i < farN; i++) {
        const x = (i / (farN - 1)) * (W + 80) - 40 + jit(i * 3) * 18;
        const h = 26 + Math.abs(jit(i * 7)) * 26;
        tree(bgCtx, i, x, horizonY + 10 + jit(i) * 6, h, 0.5, { ...pal, tree: farColor });
      }

      // Base mist veiling the horizon — the distant treeline reads as emerging
      // from fog. (Drifting wisps are added per-frame in the render loop.)
      const mist = bgCtx.createLinearGradient(0, horizonY - Hh * 0.16, 0, horizonY + Hh * 0.14);
      mist.addColorStop(0, rgba(pal.cloud, 0));
      mist.addColorStop(0.5, rgba(pal.cloud, pal.cloud[0] > 200 ? 0.5 : 0.16));
      mist.addColorStop(1, rgba(pal.cloud, 0));
      bgCtx.fillStyle = mist;
      bgCtx.fillRect(0, horizonY - Hh * 0.16, W, Hh * 0.3);

      // Big framing trees anchored at the far edges (static)
      const frame: [number, number, number][] = [
        [0.02, 0.99, 0.72], [0.12, 1.0, 0.5], [0.98, 0.99, 0.74], [0.88, 1.0, 0.52],
      ];
      frame.forEach(([fx, fy, hs], i) => {
        tree(bgCtx, i + 1, W * fx, Hh * fy, Hh * hs, 1, pal);
      });
    };

    const ensureStatic = (pal: Palette) => {
      const key = `${width}x${height}:${document.documentElement.dataset.theme}:${loaded}`;
      if (key === staticKey) return;
      renderStatic(pal);
      staticKey = key;
    };

    // ── Animated foreground trees ──
    const COUNT = 30;
    const trees: Tree[] = [];
    const spawn = (p: Tree, seed = false) => {
      p.side = Math.random() < 0.5 ? -1 : 1;
      p.t = seed ? Math.random() : Math.random() * 0.04;
      p.spd = 0.0024 + Math.random() * 0.0026;
      p.endSpread = 0.78 + Math.random() * 0.55;
      p.startJitter = (Math.random() * 2 - 1) * 22;
      p.maxH = height * (0.34 + Math.random() * 0.32);
      p.sprite = Math.floor(Math.random() * sprites.length);
    };
    for (let i = 0; i < COUNT; i++) {
      const p: Tree = { side: 1, t: 0, spd: 0, endSpread: 1, startJitter: 0, maxH: 200, sprite: 0 };
      spawn(p, true);
      trees.push(p);
    }

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = host.clientWidth;
      height = host.clientHeight;
      for (const c of [canvas, bg]) {
        c.width = Math.max(1, Math.round(width * dpr));
        c.height = Math.max(1, Math.round(height * dpr));
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      staticKey = '';
      for (const p of trees) if (p.maxH < height * 0.2) p.maxH = height * 0.45;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    let raf = 0;
    let last = 0;
    let running = true;
    const order: Tree[] = [];

    const frame = (t: number) => {
      if (!running) return;
      const dt = last ? Math.min((t - last) / 16.67, 3) : 1;
      last = t;
      const pal = palette();
      ensureStatic(pal);

      // Blit the static skyline (1:1 — bg is already DPR-sized)
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bg, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Advance + draw foreground far → near
      for (const p of trees) {
        p.t += p.spd * dt;
        if (p.t >= 1) spawn(p);
      }
      order.length = 0;
      for (const p of trees) order.push(p);
      order.sort((a, b) => a.t - b.t);

      const cx = width / 2;
      const halfW = width / 2;
      const MIST_DEPTH = 0.34; // trees below this depth sit BEHIND the mist
      const drawTreeAt = (p: Tree) => {
        const e = Math.pow(p.t, 1.7); // accelerate outward
        const x = cx + p.side * (p.startJitter * (1 - p.t) + halfW * p.endSpread * e + halfW * 0.18 * e);
        const baseY = horizonY + Math.pow(p.t, 1.7) * (height - horizonY) * 0.96;
        const h = 12 + p.maxH * Math.pow(p.t, 1.3);
        const fadeIn = Math.min(p.t * 6, 1); // soft emerge from the mist
        const fadeOut = p.t > 0.92 ? Math.max(0, (1 - p.t) / 0.08) : 1;
        if (x < -h || x > width + h) return;
        tree(ctx, p.sprite, x, baseY, h, fadeIn * fadeOut, pal);
      };

      // Distant (just-emerging) trees first — they will be veiled by the mist.
      for (const p of order) if (p.t < MIST_DEPTH) drawTreeAt(p);

      // Drifting mist band over the horizon — trees emerge THROUGH it.
      const mY = horizonY;
      const drift = (t / 9000) % 1;
      for (let i = 0; i < 3; i++) {
        const phase = (drift + i / 3) % 1;
        const mx = phase * (width + 600) - 300;
        const a = (pal.cloud[0] > 200 ? 0.22 : 0.1) * (0.5 + 0.5 * Math.sin(t / 2600 + i));
        softBlob(ctx, mx, mY - 10 + Math.sin(i * 2) * 22, 360, 70, pal.cloud, a);
        softBlob(ctx, width - mx, mY + 18 + Math.cos(i * 2) * 20, 320, 60, pal.cloud, a * 0.85);
      }

      // Near trees in front of the mist.
      for (const p of order) if (p.t >= MIST_DEPTH) drawTreeAt(p);

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
