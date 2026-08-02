'use client';

import { useEffect, useRef } from 'react';

type RGB = [number, number, number];
type Point = { x: number; y: number };

interface Neuron extends Point {
  radius: number;
  phase: number;
  activation: number;
  color: RGB;
}

interface Synapse {
  a: number;
  b: number;
  bend: number;
}

interface Signal {
  synapse: number;
  from: number;
  progress: number;
  velocity: number;
  color: RGB;
}

const BLUE: RGB = [72, 149, 255];
const CYAN: RGB = [20, 226, 211];
const VIOLET: RGB = [137, 113, 255];
const WHITE: RGB = [226, 244, 255];

const rgba = ([r, g, b]: RGB, alpha: number) => `rgba(${r}, ${g}, ${b}, ${alpha})`;
const mix = (a: RGB, b: RGB, amount: number): RGB => [
  Math.round(a[0] + (b[0] - a[0]) * amount),
  Math.round(a[1] + (b[1] - a[1]) * amount),
  Math.round(a[2] + (b[2] - a[2]) * amount),
];

/** Stable pseudo-randomness keeps the anatomy from jumping whenever the hero resizes. */
const seededRandom = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
};

function traceBrain(path: CanvasRenderingContext2D | Path2D, cx: number, cy: number, sx: number, sy: number) {
  path.moveTo(cx, cy + sy * 0.73);
  path.bezierCurveTo(cx - sx * 0.12, cy + sy * 0.72, cx - sx * 0.18, cy + sy * 0.65, cx - sx * 0.25, cy + sy * 0.61);
  path.bezierCurveTo(cx - sx * 0.45, cy + sy * 0.65, cx - sx * 0.64, cy + sy * 0.52, cx - sx * 0.66, cy + sy * 0.34);
  path.bezierCurveTo(cx - sx * 0.83, cy + sy * 0.27, cx - sx * 0.89, cy + sy * 0.06, cx - sx * 0.8, cy - sy * 0.08);
  path.bezierCurveTo(cx - sx * 0.88, cy - sy * 0.26, cx - sx * 0.75, cy - sy * 0.43, cx - sx * 0.61, cy - sy * 0.48);
  path.bezierCurveTo(cx - sx * 0.59, cy - sy * 0.66, cx - sx * 0.4, cy - sy * 0.76, cx - sx * 0.25, cy - sy * 0.72);
  path.bezierCurveTo(cx - sx * 0.17, cy - sy * 0.85, cx - sx * 0.04, cy - sy * 0.83, cx, cy - sy * 0.74);
  path.bezierCurveTo(cx + sx * 0.08, cy - sy * 0.84, cx + sx * 0.23, cy - sy * 0.83, cx + sx * 0.29, cy - sy * 0.7);
  path.bezierCurveTo(cx + sx * 0.48, cy - sy * 0.76, cx + sx * 0.65, cy - sy * 0.63, cx + sx * 0.64, cy - sy * 0.48);
  path.bezierCurveTo(cx + sx * 0.82, cy - sy * 0.43, cx + sx * 0.88, cy - sy * 0.24, cx + sx * 0.79, cy - sy * 0.08);
  path.bezierCurveTo(cx + sx * 0.89, cy + sy * 0.09, cx + sx * 0.81, cy + sy * 0.27, cx + sx * 0.67, cy + sy * 0.34);
  path.bezierCurveTo(cx + sx * 0.66, cy + sy * 0.54, cx + sx * 0.44, cy + sy * 0.65, cx + sx * 0.25, cy + sy * 0.61);
  path.bezierCurveTo(cx + sx * 0.17, cy + sy * 0.7, cx + sx * 0.1, cy + sy * 0.73, cx, cy + sy * 0.73);
  path.closePath();
}

/** Curved interpolation shared by the synapse line and its moving packet. */
function synapsePoint(a: Point, b: Point, bend: number, progress: number): Point {
  const mx = (a.x + b.x) * 0.5;
  const my = (a.y + b.y) * 0.5;
  const length = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
  const control = {
    x: mx - ((b.y - a.y) / length) * bend,
    y: my + ((b.x - a.x) / length) * bend,
  };
  const inv = 1 - progress;
  return {
    x: inv * inv * a.x + 2 * inv * progress * control.x + progress * progress * b.x,
    y: inv * inv * a.y + 2 * inv * progress * control.y + progress * progress * b.y,
  };
}

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
    let cx = 0;
    let cy = 0;
    let sx = 1;
    let sy = 1;
    let brainPath = new Path2D();
    let neurons: Neuron[] = [];
    let synapses: Synapse[] = [];
    let signals: Signal[] = [];
    let emitIn = 0;
    let lastTime = 0;
    let raf = 0;
    let running = true;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    const insideBrain = (x: number, y: number) => {
      const nx = Math.abs((x - cx) / sx);
      const ny = (y - cy) / sy;
      const crown = nx * nx / 0.78 + (ny + 0.04) * (ny + 0.04);
      return crown < 0.62 && ny > -0.72 && ny < 0.61;
    };

    const buildAnatomy = () => {
      brainPath = new Path2D();
      traceBrain(brainPath, cx, cy, sx, sy);

      const random = seededRandom(0x45564552);
      neurons = [];
      let attempts = 0;
      while (neurons.length < 92 && attempts++ < 5000) {
        const x = cx + (random() * 1.56 - 0.78) * sx;
        const y = cy + (random() * 1.3 - 0.69) * sy;
        if (!insideBrain(x, y)) continue;
        if (neurons.some((node) => Math.hypot(node.x - x, node.y - y) < sx * 0.055)) continue;
        const blend = (x - (cx - sx)) / (sx * 2);
        neurons.push({
          x,
          y,
          radius: Math.max(1.1, sx * (0.0024 + random() * 0.0026)),
          phase: random() * Math.PI * 2,
          activation: 0,
          color: blend < 0.5 ? mix(CYAN, BLUE, blend * 1.35) : mix(BLUE, VIOLET, (blend - 0.5) * 1.3),
        });
      }

      synapses = [];
      neurons.forEach((node, index) => {
        const nearest = neurons
          .map((other, otherIndex) => ({ otherIndex, distance: Math.hypot(other.x - node.x, other.y - node.y) }))
          .filter(({ otherIndex }) => otherIndex !== index)
          .sort((a, b) => a.distance - b.distance)
          .slice(0, 3);
        nearest.forEach(({ otherIndex, distance }, rank) => {
          if (synapses.some((edge) => (edge.a === index && edge.b === otherIndex) || (edge.a === otherIndex && edge.b === index))) return;
          const direction = ((index + otherIndex + rank) & 1) ? 1 : -1;
          synapses.push({ a: index, b: otherIndex, bend: distance * (0.08 + random() * 0.13) * direction });
        });
      });
      signals = [];
      emitIn = 0;
    };

    const resize = () => {
      width = Math.max(1, host.clientWidth);
      height = Math.max(1, host.clientHeight);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      cx = width * 0.5;
      cy = height * 0.43;
      sx = Math.min(width * 0.43, height * 0.69);
      sy = sx * 0.82;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      buildAnatomy();
      draw(performance.now(), 0);
    };

    const drawBackground = () => {
      const background = ctx.createLinearGradient(0, 0, 0, height);
      background.addColorStop(0, '#030711');
      background.addColorStop(0.65, '#07101d');
      background.addColorStop(1, '#0a1220');
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);

      const aura = ctx.createRadialGradient(cx, cy, sx * 0.15, cx, cy, sx * 1.08);
      aura.addColorStop(0, 'rgba(49, 100, 185, .10)');
      aura.addColorStop(0.58, 'rgba(18, 156, 174, .075)');
      aura.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = aura;
      ctx.fillRect(cx - sx * 1.2, cy - sy * 1.25, sx * 2.4, sy * 2.5);
    };

    const drawBrainVolume = (time: number) => {
      ctx.save();
      ctx.shadowColor = 'rgba(43, 172, 224, .3)';
      ctx.shadowBlur = Math.max(18, sx * 0.055);
      const volume = ctx.createRadialGradient(cx - sx * 0.22, cy - sy * 0.34, sx * 0.04, cx, cy, sx);
      volume.addColorStop(0, 'rgba(102, 188, 255, .23)');
      volume.addColorStop(0.38, 'rgba(43, 113, 179, .16)');
      volume.addColorStop(0.72, 'rgba(18, 68, 111, .12)');
      volume.addColorStop(1, 'rgba(3, 24, 43, .025)');
      ctx.fillStyle = volume;
      ctx.fill(brainPath);
      ctx.restore();

      ctx.save();
      ctx.clip(brainPath);
      const hemisphere = ctx.createLinearGradient(cx - sx, 0, cx + sx, 0);
      hemisphere.addColorStop(0, 'rgba(14, 226, 207, .075)');
      hemisphere.addColorStop(0.45, 'rgba(38, 102, 178, .02)');
      hemisphere.addColorStop(0.52, 'rgba(4, 12, 28, .12)');
      hemisphere.addColorStop(1, 'rgba(130, 104, 255, .075)');
      ctx.fillStyle = hemisphere;
      ctx.fillRect(cx - sx, cy - sy, sx * 2, sy * 2);

      // Fine cortical texture gives the translucent tissue physical depth.
      const random = seededRandom(0x42524149);
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 120; i++) {
        const x = cx + (random() * 1.7 - 0.85) * sx;
        const y = cy + (random() * 1.5 - 0.78) * sy;
        if (!insideBrain(x, y)) continue;
        const radius = sx * (0.004 + random() * 0.013);
        const shimmer = 0.5 + 0.5 * Math.sin(time * 0.00045 + i);
        const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
        glow.addColorStop(0, `rgba(91, 196, 236, ${0.018 + shimmer * 0.018})`);
        glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = glow;
        ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
      }
      ctx.restore();
    };

    const drawCorticalFolds = () => {
      ctx.save();
      ctx.clip(brainPath);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const random = seededRandom(0x47595249);

      for (const side of [-1, 1]) {
        for (let row = 0; row < 8; row++) {
          const y = cy + (-0.57 + row * 0.15) * sy;
          const rowInset = Math.abs(row - 3.5) * 0.022;
          for (let column = 0; column < 3; column++) {
            const start = 0.05 + column * 0.2 + rowInset + random() * 0.035;
            const length = 0.13 + random() * 0.11;
            const x1 = cx + side * sx * start;
            const x2 = cx + side * sx * Math.min(0.72, start + length);
            const lift = (random() - 0.5) * sy * 0.12;
            const direction = side < 0 ? -1 : 1;
            ctx.beginPath();
            ctx.moveTo(x1, y);
            ctx.bezierCurveTo(
              x1 + direction * sx * length * 0.25, y - lift,
              x2 - direction * sx * length * 0.35, y + lift,
              x2, y + (random() - 0.5) * sy * 0.06,
            );
            ctx.strokeStyle = side < 0 ? 'rgba(33, 196, 206, .16)' : 'rgba(102, 129, 244, .15)';
            ctx.lineWidth = Math.max(0.8, sx * 0.0022);
            ctx.shadowColor = side < 0 ? 'rgba(0, 229, 204, .24)' : 'rgba(103, 134, 255, .24)';
            ctx.shadowBlur = 5;
            ctx.stroke();
          }
        }
      }
      ctx.restore();

      // Longitudinal fissure and secondary branch sulci sell the anatomy at a glance.
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(cx, cy - sy * 0.73);
      ctx.bezierCurveTo(cx - sx * 0.025, cy - sy * 0.42, cx + sx * 0.025, cy - sy * 0.14, cx, cy + sy * 0.13);
      ctx.bezierCurveTo(cx - sx * 0.02, cy + sy * 0.32, cx + sx * 0.015, cy + sy * 0.51, cx, cy + sy * 0.69);
      ctx.strokeStyle = 'rgba(2, 9, 20, .72)';
      ctx.lineWidth = Math.max(2.2, sx * 0.009);
      ctx.shadowColor = 'rgba(67, 158, 229, .32)';
      ctx.shadowBlur = 7;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - sx * 0.54, cy - sy * 0.04);
      ctx.bezierCurveTo(cx - sx * 0.37, cy - sy * 0.1, cx - sx * 0.31, cy + sy * 0.04, cx - sx * 0.14, cy + sy * 0.02);
      ctx.moveTo(cx + sx * 0.54, cy - sy * 0.04);
      ctx.bezierCurveTo(cx + sx * 0.37, cy - sy * 0.1, cx + sx * 0.31, cy + sy * 0.04, cx + sx * 0.14, cy + sy * 0.02);
      ctx.strokeStyle = 'rgba(5, 23, 41, .68)';
      ctx.lineWidth = Math.max(1.4, sx * 0.005);
      ctx.stroke();
      ctx.restore();
    };

    const drawNeuralActivity = (time: number) => {
      ctx.save();
      ctx.clip(brainPath);
      ctx.globalCompositeOperation = 'lighter';

      synapses.forEach((edge) => {
        const a = neurons[edge.a];
        const b = neurons[edge.b];
        const control = synapsePoint(a, b, edge.bend, 0.5);
        const activation = Math.max(a.activation, b.activation);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(control.x, control.y, b.x, b.y);
        ctx.strokeStyle = rgba(mix(a.color, b.color, 0.5), 0.045 + activation * 0.16);
        ctx.lineWidth = 0.55 + activation * 1.15;
        ctx.stroke();
      });

      neurons.forEach((neuron) => {
        const pulse = 0.55 + Math.sin(time * 0.0014 + neuron.phase) * 0.2 + neuron.activation * 0.65;
        const haloRadius = neuron.radius * (3.4 + pulse * 2.2);
        const halo = ctx.createRadialGradient(neuron.x, neuron.y, 0, neuron.x, neuron.y, haloRadius);
        halo.addColorStop(0, rgba(neuron.color, 0.24 + neuron.activation * 0.46));
        halo.addColorStop(1, rgba(neuron.color, 0));
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(neuron.x, neuron.y, haloRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = rgba(mix(neuron.color, WHITE, 0.54), 0.54 + neuron.activation * 0.4);
        ctx.beginPath();
        ctx.arc(neuron.x, neuron.y, neuron.radius * (0.75 + pulse * 0.2), 0, Math.PI * 2);
        ctx.fill();
      });

      signals.forEach((signal) => {
        const edge = synapses[signal.synapse];
        if (!edge) return;
        const destination = signal.from === edge.a ? edge.b : edge.a;
        const point = synapsePoint(neurons[signal.from], neurons[destination], edge.bend, signal.progress);
        const radius = Math.max(7, sx * 0.014);
        const glow = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius);
        glow.addColorStop(0, rgba(WHITE, 0.98));
        glow.addColorStop(0.16, rgba(signal.color, 0.9));
        glow.addColorStop(1, rgba(signal.color, 0));
        ctx.fillStyle = glow;
        ctx.fillRect(point.x - radius, point.y - radius, radius * 2, radius * 2);
      });
      ctx.restore();
    };

    const drawOutline = () => {
      const outline = ctx.createLinearGradient(cx - sx, cy, cx + sx, cy);
      outline.addColorStop(0, 'rgba(25, 227, 208, .52)');
      outline.addColorStop(0.5, 'rgba(74, 161, 245, .46)');
      outline.addColorStop(1, 'rgba(143, 113, 255, .5)');
      ctx.save();
      ctx.strokeStyle = outline;
      ctx.lineWidth = Math.max(1.15, sx * 0.0028);
      ctx.shadowColor = 'rgba(62, 166, 235, .55)';
      ctx.shadowBlur = 14;
      ctx.stroke(brainPath);
      ctx.restore();
    };

    const updateSignals = (delta: number) => {
      neurons.forEach((neuron) => { neuron.activation = Math.max(0, neuron.activation - delta * 0.0011); });
      emitIn -= delta;
      if (emitIn <= 0 && signals.length < 12 && synapses.length) {
        const random = seededRandom(Math.floor(performance.now() / 180));
        const synapse = Math.floor(random() * synapses.length);
        const edge = synapses[synapse];
        const from = random() > 0.5 ? edge.a : edge.b;
        signals.push({ synapse, from, progress: 0, velocity: 0.00042 + random() * 0.00032, color: neurons[from].color });
        emitIn = 130 + random() * 210;
      }

      for (let index = signals.length - 1; index >= 0; index--) {
        const signal = signals[index];
        signal.progress += signal.velocity * delta;
        if (signal.progress < 1) continue;
        const edge = synapses[signal.synapse];
        const destination = signal.from === edge.a ? edge.b : edge.a;
        neurons[destination].activation = 1;
        signals.splice(index, 1);
      }
    };

    const draw = (time: number, delta: number) => {
      drawBackground();
      drawBrainVolume(time);
      drawCorticalFolds();
      if (!reduceMotion.matches) updateSignals(delta);
      drawNeuralActivity(time);
      drawOutline();
    };

    const frame = (time: number) => {
      if (!running) return;
      const delta = lastTime ? Math.min(40, time - lastTime) : 16;
      lastTime = time;
      draw(time, delta);
      if (!reduceMotion.matches) raf = requestAnimationFrame(frame);
    };

    const start = () => {
      cancelAnimationFrame(raf);
      lastTime = 0;
      draw(performance.now(), 0);
      if (!document.hidden && !reduceMotion.matches) raf = requestAnimationFrame(frame);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    start();

    const onVisibilityChange = () => {
      if (document.hidden) cancelAnimationFrame(raf);
      else start();
    };
    const onMotionChange = () => start();
    document.addEventListener('visibilitychange', onVisibilityChange);
    reduceMotion.addEventListener('change', onMotionChange);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      reduceMotion.removeEventListener('change', onMotionChange);
    };
  }, []);

  return (
    <div className={`wb-scene ${className}`} aria-hidden="true">
      <canvas ref={canvasRef} className="wb-canvas" />
      <div className="wb-veil" />
      <div className="wb-fade" />
    </div>
  );
}
