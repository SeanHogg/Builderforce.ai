'use client';

import { useEffect, useRef } from 'react';

/**
 * WaveBackdrop — a first-person "flying through a forest" hero: a bright open
 * lane at the centre (the path / sky ahead) framed by a tree line that streams
 * OUTWARD from the vanishing point toward the left and right edges, each conifer
 * growing + dropping as it rushes past the camera (classic driving-down-a-tree-
 * lined-road perspective). Distant trees fade into atmospheric haze near the
 * centre and resolve as they approach.
 *
 * Driven by a <canvas> + requestAnimationFrame render loop (the same always-on
 * technique sites like contextqa.com use) — a JS render loop is NOT silenced by
 * the browser's `prefers-reduced-motion` setting, so it reliably animates on
 * load for everyone. Theme-reactive (reads `data-theme`), DPR-aware, pauses when
 * the tab is hidden, and tears down on unmount.
 *
 * (Name kept as WaveBackdrop so the single import site doesn't churn; it is the
 * hero backdrop regardless of motif.)
 */

type RGB = [number, number, number];
interface Palette {
  skyTop: RGB;
  skyHorizon: RGB;
  glow: RGB; // bright centre lane (kept readable behind hero text)
  ground: RGB;
  tree: RGB;
  haze: RGB; // colour distant trees fade toward (atmospheric perspective)
}

const DARK: Palette = {
  skyTop: [8, 16, 38],
  skyHorizon: [28, 52, 92],
  glow: [120, 160, 220],
  ground: [6, 12, 26],
  tree: [9, 22, 32],
  haze: [28, 52, 92],
};
const LIGHT: Palette = {
  skyTop: [150, 198, 238],
  skyHorizon: [206, 231, 250],
  glow: [255, 255, 255],
  ground: [120, 150, 120],
  tree: [26, 64, 50],
  haze: [206, 231, 250],
};

const rgba = ([r, g, b]: RGB, a: number) => `rgba(${r},${g},${b},${a})`;
const mix = (a: RGB, b: RGB, t: number): RGB => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];

interface Tree {
  side: -1 | 1; // streams to the left or right edge
  t: number; // 0 (far, at vanishing point) → 1 (near, off-screen)
  spd: number; // progress per frame
  endSpread: number; // how far out it ends, as a fraction of half-width
  startJitter: number; // small horizontal offset at the vanishing point
  maxH: number; // tree height at t≈1 (px)
  hue: number; // small per-tree colour variation
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
    const COUNT = 46;
    const trees: Tree[] = [];

    const spawn = (p: Tree, seed = false) => {
      p.side = Math.random() < 0.5 ? -1 : 1;
      p.t = seed ? Math.random() : Math.random() * 0.05;
      p.spd = 0.0026 + Math.random() * 0.0026;
      p.endSpread = 0.62 + Math.random() * 0.5; // 0.62–1.12 of half-width
      p.startJitter = (Math.random() * 2 - 1) * 26;
      p.maxH = 150 + Math.random() * 170;
      p.hue = Math.random() * 0.3 - 0.15;
    };

    for (let i = 0; i < COUNT; i++) {
      const p: Tree = { side: 1, t: 0, spd: 0, endSpread: 1, startJitter: 0, maxH: 200, hue: 0 };
      spawn(p, true);
      trees.push(p);
    }

    const palette = () => (document.documentElement.dataset.theme === 'light' ? LIGHT : DARK);

    // Cache the static sky+ground gradient between frames of the same size/theme.
    let bgKey = '';
    let sky: CanvasGradient | null = null;
    let ground: CanvasGradient | null = null;
    let glow: CanvasGradient | null = null;
    let horizonY = 0;
    const buildBg = (pal: Palette) => {
      const key = `${width}x${height}:${document.documentElement.dataset.theme}`;
      if (key === bgKey && sky && ground && glow) return;
      horizonY = height * 0.44;
      const s = ctx.createLinearGradient(0, 0, 0, horizonY);
      s.addColorStop(0, rgba(pal.skyTop, 1));
      s.addColorStop(1, rgba(pal.skyHorizon, 1));
      sky = s;
      const g = ctx.createLinearGradient(0, horizonY, 0, height);
      g.addColorStop(0, rgba(pal.skyHorizon, 1));
      g.addColorStop(1, rgba(pal.ground, 1));
      ground = g;
      const gl = ctx.createRadialGradient(width / 2, horizonY, 0, width / 2, horizonY, Math.max(width, height) * 0.5);
      gl.addColorStop(0, rgba(pal.glow, 0.85));
      gl.addColorStop(0.5, rgba(pal.glow, 0.12));
      gl.addColorStop(1, rgba(pal.glow, 0));
      glow = gl;
      bgKey = key;
    };

    /** Draw one conifer silhouette: base at (x, baseY), total height h. */
    const drawTree = (x: number, baseY: number, h: number, color: RGB, alpha: number) => {
      const w = h * 0.46;
      const trunkH = h * 0.14;
      const fy = baseY - trunkH; // foliage base
      ctx.fillStyle = rgba(color, alpha);
      // trunk
      ctx.fillRect(x - h * 0.035, fy, h * 0.07, trunkH);
      // three stacked tiers
      ctx.beginPath();
      ctx.moveTo(x - w / 2, fy);
      ctx.lineTo(x + w / 2, fy);
      ctx.lineTo(x, fy - h * 0.46);
      ctx.closePath();
      ctx.moveTo(x - w * 0.38, fy - h * 0.28);
      ctx.lineTo(x + w * 0.38, fy - h * 0.28);
      ctx.lineTo(x, fy - h * 0.72);
      ctx.closePath();
      ctx.moveTo(x - w * 0.26, fy - h * 0.56);
      ctx.lineTo(x + w * 0.26, fy - h * 0.56);
      ctx.lineTo(x, fy - h);
      ctx.closePath();
      ctx.fill();
    };

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = host.clientWidth;
      height = host.clientHeight;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      bgKey = '';
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
      buildBg(pal);
      const cx = width / 2;

      // Sky, ground, bright centre glow
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = sky!;
      ctx.fillRect(0, 0, width, horizonY);
      ctx.fillStyle = ground!;
      ctx.fillRect(0, horizonY, width, height - horizonY);
      ctx.fillStyle = glow!;
      ctx.fillRect(0, 0, width, height);

      // Advance, then draw far → near so nearer trees overlap correctly
      for (const p of trees) {
        p.t += p.spd * dt;
        if (p.t >= 1) spawn(p);
      }
      order.length = 0;
      for (const p of trees) order.push(p);
      order.sort((a, b) => a.t - b.t);

      const halfW = width / 2;
      for (const p of order) {
        const e = Math.pow(p.t, 1.7); // accelerate outward (perspective)
        const x = cx + p.side * (p.startJitter * (1 - p.t) + halfW * p.endSpread * e);
        const baseY = horizonY + Math.pow(p.t, 1.8) * (height - horizonY) * 1.05;
        const h = 6 + p.maxH * Math.pow(p.t, 1.25);
        const alpha = Math.min(p.t * 7, 1) * 0.96;
        // Atmospheric perspective: distant (small t) trees fade toward haze.
        const col = mix(pal.haze, pal.tree, Math.min(1, p.t * 1.6));
        const shade = mix(col, [0, 0, 0], Math.max(0, p.hue));
        drawTree(x, baseY, h, p.hue < 0 ? mix(col, [255, 255, 255], -p.hue * 0.5) : shade, alpha);
      }

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
