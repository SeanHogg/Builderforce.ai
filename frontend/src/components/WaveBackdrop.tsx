'use client';

import { useEffect, useRef } from 'react';

/**
 * WaveBackdrop — a first-person "rushing forward through water" hero, like the
 * view from a jetski: a bright open lane at the centre vanishing point (the path
 * ahead) with spray streaks that fly OUTWARD from it, accelerating + growing as
 * they rush past the camera, and waves splashing up the side edges.
 *
 * Driven by a <canvas> + requestAnimationFrame render loop — the same class of
 * technique sites like contextqa.com use for their always-on hero motion. A JS
 * render loop (unlike a CSS animation) is NOT silenced by the browser's
 * `prefers-reduced-motion` setting, so the scene reliably animates on load for
 * every visitor. It is theme-reactive (reads `data-theme`), DPR-aware, pauses
 * when the tab is hidden, and fully tears down on unmount.
 */

type RGB = [number, number, number];
interface Palette {
  glow: RGB;
  waterFar: RGB;
  waterNear: RGB;
  streak: RGB;
  foam: RGB;
}

const DARK: Palette = {
  glow: [190, 230, 255],
  waterFar: [22, 52, 95],
  waterNear: [5, 15, 36],
  streak: [150, 210, 255],
  foam: [215, 240, 255],
};
const LIGHT: Palette = {
  glow: [255, 255, 255],
  waterFar: [140, 205, 238],
  waterNear: [26, 114, 184],
  streak: [255, 255, 255],
  foam: [255, 255, 255],
};

const rgba = ([r, g, b]: RGB, a: number) => `rgba(${r},${g},${b},${a})`;

interface Particle {
  ang: number; // travel direction (radians, y points down)
  r: number; // distance from the vanishing point
  v: number; // current speed (accelerates → perspective rush)
  size: number; // per-particle width multiplier
  fade: number; // per-particle opacity multiplier
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
    const COUNT = 100;
    const particles: Particle[] = [];

    /** A fresh streak: spawned near the vanishing point, aimed into one of two
     *  downward fans (down-right / down-left) so the upper-centre lane stays open. */
    const spawn = (p: Particle, seed = false) => {
      const right = Math.random() < 0.5;
      // Right fan 5°–85°, left fan 95°–175° (degrees; y points down).
      const deg = right ? 5 + Math.random() * 80 : 95 + Math.random() * 80;
      p.ang = (deg * Math.PI) / 180;
      p.r = seed ? Math.random() * 0.55 : Math.random() * 0.04; // seed: pre-fill the field
      p.v = 0.0016 + Math.random() * 0.0018;
      p.size = 0.6 + Math.random() * 1.1;
      p.fade = 0.5 + Math.random() * 0.5;
    };

    for (let i = 0; i < COUNT; i++) {
      const p: Particle = { ang: 0, r: 0, v: 0, size: 1, fade: 1 };
      spawn(p, true);
      particles.push(p);
    }

    const palette = () => (document.documentElement.dataset.theme === 'light' ? LIGHT : DARK);

    let bgKey = '';
    let bg: CanvasGradient | null = null;
    const buildBg = (cx: number, cy: number, pal: Palette) => {
      const key = `${width}x${height}:${document.documentElement.dataset.theme}`;
      if (key === bgKey && bg) return bg;
      const maxR = Math.hypot(Math.max(cx, width - cx), Math.max(cy, height - cy));
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR);
      g.addColorStop(0, rgba(pal.glow, 1));
      g.addColorStop(0.4, rgba(pal.waterFar, 1));
      g.addColorStop(1, rgba(pal.waterNear, 1));
      bg = g;
      bgKey = key;
      return g;
    };

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = host.clientWidth;
      height = host.clientHeight;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      bgKey = ''; // force gradient rebuild at the new size
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    let raf = 0;
    let last = 0;
    let running = true;

    const frame = (t: number) => {
      if (!running) return;
      const dt = last ? Math.min((t - last) / 16.67, 3) : 1; // frames elapsed (~clamped)
      last = t;
      const pal = palette();
      const cx = width * 0.5;
      const cy = height * 0.39;

      // Water + bright centre lane
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = buildBg(cx, cy, pal);
      ctx.fillRect(0, 0, width, height);

      // Streaks rushing outward, drawn additively so crossings glow like spray
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      const reach = Math.hypot(width, height) * 0.62;
      for (const p of particles) {
        p.v *= 1 + 0.018 * dt; // accelerate toward the camera
        p.r += p.v * dt;
        const rad = p.r * reach;
        const cos = Math.cos(p.ang);
        const sin = Math.sin(p.ang);
        const x = cx + cos * rad;
        const y = cy + sin * rad;
        if (x < -60 || x > width + 60 || y > height + 60 || p.r > 1.25) {
          spawn(p);
          continue;
        }
        // Tail a little behind for a motion-streak look
        const rad2 = Math.max(0, rad - (12 + rad * 0.16));
        const x2 = cx + cos * rad2;
        const y2 = cy + sin * rad2;
        // Fade in near the centre, fade out near the edges
        const a = Math.min(p.r * 6, 1) * (1 - Math.max(0, p.r - 0.85) / 0.4) * p.fade;
        const w = (0.6 + p.r * 5) * p.size;
        // Body
        ctx.strokeStyle = rgba(pal.streak, 0.5 * a);
        ctx.lineWidth = w * 1.8;
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x, y);
        ctx.stroke();
        // Bright foam core
        ctx.strokeStyle = rgba(pal.foam, a);
        ctx.lineWidth = w * 0.7;
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x, y);
        ctx.stroke();
      }

      // Waves splashing up the side edges (bobbing alpha)
      const sway = 0.28 + 0.22 * Math.sin(t / 520);
      const swayR = 0.28 + 0.22 * Math.sin(t / 520 + 1.4);
      const edge = Math.min(width * 0.16, 190);
      const lg = ctx.createLinearGradient(0, 0, edge, 0);
      lg.addColorStop(0, rgba(pal.foam, sway));
      lg.addColorStop(1, rgba(pal.foam, 0));
      ctx.fillStyle = lg;
      ctx.fillRect(0, 0, edge, height);
      const rg = ctx.createLinearGradient(width, 0, width - edge, 0);
      rg.addColorStop(0, rgba(pal.foam, swayR));
      rg.addColorStop(1, rgba(pal.foam, 0));
      ctx.fillStyle = rg;
      ctx.fillRect(width - edge, 0, edge, height);

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
