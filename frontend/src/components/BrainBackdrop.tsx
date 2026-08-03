'use client';

import Image from 'next/image';
import { useEffect, useRef } from 'react';

type Point = { x: number; y: number };

const PATHS: Point[][] = [
  [{ x: .25, y: .3 }, { x: .38, y: .22 }, { x: .5, y: .34 }, { x: .62, y: .2 }, { x: .76, y: .31 }],
  [{ x: .19, y: .45 }, { x: .34, y: .38 }, { x: .48, y: .49 }, { x: .65, y: .36 }, { x: .81, y: .47 }],
  [{ x: .22, y: .59 }, { x: .36, y: .51 }, { x: .51, y: .61 }, { x: .68, y: .5 }, { x: .78, y: .61 }],
  [{ x: .29, y: .72 }, { x: .42, y: .65 }, { x: .52, y: .76 }, { x: .66, y: .67 }, { x: .72, y: .74 }],
  [{ x: .37, y: .17 }, { x: .44, y: .34 }, { x: .39, y: .51 }, { x: .46, y: .7 }],
  [{ x: .64, y: .16 }, { x: .57, y: .32 }, { x: .63, y: .51 }, { x: .55, y: .72 }],
];

const pointOnPath = (path: Point[], progress: number): Point => {
  const scaled = progress * (path.length - 1);
  const index = Math.min(path.length - 2, Math.floor(scaled));
  const amount = scaled - index;
  const a = path[index];
  const b = path[index + 1];
  return { x: a.x + (b.x - a.x) * amount, y: a.y + (b.y - a.y) * amount };
};

export default function BrainBackdrop({ className = '' }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !host || !ctx) return;

    let width = 1;
    let height = 1;
    let dpr = 1;
    let frameId = 0;
    let visible = true;

    const resize = () => {
      width = Math.max(1, host.clientWidth);
      height = Math.max(1, host.clientHeight);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = (time: number) => {
      ctx.clearRect(0, 0, width, height);
      const brainWidth = Math.min(width * .74, height * .92);
      const brainHeight = brainWidth * 1.12;
      const left = (width - brainWidth) / 2;
      const top = height * .43 - brainHeight * .47;

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';

      PATHS.forEach((path, pathIndex) => {
        ctx.beginPath();
        path.forEach((point, index) => {
          const x = left + point.x * brainWidth;
          const y = top + point.y * brainHeight;
          if (!index) ctx.moveTo(x, y);
          else {
            const previous = path[index - 1];
            const px = left + previous.x * brainWidth;
            const py = top + previous.y * brainHeight;
            const mx = (px + x) / 2;
            const my = (py + y) / 2;
            ctx.quadraticCurveTo(px, py, mx, my);
          }
        });
        const hue = pathIndex % 2 ? '118, 109, 255' : '22, 225, 213';
        const wave = .5 + .5 * Math.sin(time * .0024 + pathIndex * 1.7);
        ctx.strokeStyle = `rgba(${hue}, ${.1 + wave * .14})`;
        ctx.lineWidth = 1.1 + wave * 1.4;
        ctx.shadowColor = `rgba(${hue}, .9)`;
        ctx.shadowBlur = 8 + wave * 11;
        ctx.stroke();

        const packets = pathIndex < 4 ? 3 : 2;
        for (let packet = 0; packet < packets; packet++) {
          const progress = (time * (.0001 + pathIndex * .000009) + packet / packets + pathIndex * .13) % 1;
          const point = pointOnPath(path, progress);
          const x = left + point.x * brainWidth;
          const y = top + point.y * brainHeight;
          const radius = 13 + wave * 10;
          const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
          glow.addColorStop(0, 'rgba(255,255,255,.98)');
          glow.addColorStop(.14, `rgba(${hue}, .95)`);
          glow.addColorStop(1, `rgba(${hue}, 0)`);
          ctx.fillStyle = glow;
          ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
        }
      });

      // Large, visible waves travel out from the brain's core.
      for (let ring = 0; ring < 3; ring++) {
        const phase = (time * .00022 + ring / 3) % 1;
        ctx.beginPath();
        ctx.ellipse(width / 2, top + brainHeight * .49, brainWidth * (.08 + phase * .48), brainHeight * (.05 + phase * .35), 0, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${ring === 1 ? '121, 108, 255' : '24, 211, 224'}, ${Math.max(0, .32 * (1 - phase))})`;
        ctx.lineWidth = 2;
        ctx.shadowBlur = 14;
        ctx.stroke();
      }
      ctx.restore();

      if (visible) frameId = requestAnimationFrame(draw);
    };

    const restart = () => {
      cancelAnimationFrame(frameId);
      draw(performance.now());
    };
    const onVisibility = () => {
      visible = !document.hidden;
      if (visible) restart();
      else cancelAnimationFrame(frameId);
    };

    resize();
    // Use requestAnimationFrame to debounce resize callbacks and prevent
    // "ResizeObserver loop completed with undelivered notifications" errors.
    let rafId: number | null = null;
    const observer = new ResizeObserver(() => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        resize();
        restart();
      });
    });
    observer.observe(host);
    document.addEventListener('visibilitychange', onVisibility);
    restart();

    return () => {
      visible = false;
      if (rafId !== null) cancelAnimationFrame(rafId);
      cancelAnimationFrame(frameId);
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return (
    <div className={`wb-scene ${className}`} aria-hidden="true">
      <div className="wb-brain-aura" />
      <div className="wb-brain-shell">
        <Image
          src="/images/hero/evermind-brain.png"
          alt=""
          fill
          priority
          sizes="(max-width: 700px) 92vw, 760px"
          className="wb-brain-image"
        />
        <div className="wb-brain-scan" />
      </div>
      <canvas ref={canvasRef} className="wb-canvas wb-activity-canvas" />
      <div className="wb-veil" />
      <div className="wb-fade" />
    </div>
  );
}
