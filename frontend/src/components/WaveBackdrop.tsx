'use client';

/**
 * WaveBackdrop — a layered ocean that "emerges" on mount: stacked wave bands
 * rise + fade in from the bottom (staggered horizon → foreground), then drift
 * horizontally at parallax speeds with a gentle bob, foam highlights riding
 * each crest. Inspired by the contextqa.com hero, rebuilt as an original SVG
 * scene themed to the BuilderForce palette so it works on light and dark.
 *
 * Pure presentation: pointer-events: none, aria-hidden. The caller positions it
 * absolutely behind hero content. All motion is gated behind
 * `prefers-reduced-motion` in globals.css — reduced-motion users get the final
 * resting scene with no animation.
 *
 * Geometry is generated deterministically (no Math.random) so server and client
 * render identically, avoiding hydration mismatch.
 */

const W = 1200;
const H = 600;

interface WaveLayer {
  baseY: number;
  amp: number;
  wavelength: number;
  phase: number;
  fill: string;
  /** Horizontal drift duration (seconds). Larger = slower. */
  driftDur: number;
  /** Drift direction: -1 drifts left, +1 drifts right (parallax variety). */
  dir: 1 | -1;
  /** Emerge delay (seconds) — horizon emerges first, foreground last. */
  delay: number;
  /** Whether to draw a foam highlight along the crest. */
  foam: boolean;
}

/**
 * Build a filled wave band: a sine crest sampled across [-λ, W+λ] (extra on
 * both sides so the band never gaps as it drifts either direction), closed down
 * to the floor. `crestOnly` returns just the open crest polyline (for foam).
 */
function wavePath(layer: WaveLayer, crestOnly = false): string {
  const { baseY, amp, wavelength, phase } = layer;
  const start = -wavelength;
  const end = W + wavelength;
  const step = wavelength / 14;
  const pts: string[] = [];
  for (let x = start; x <= end; x += step) {
    const y = baseY + amp * Math.sin((2 * Math.PI * x) / wavelength + phase);
    pts.push(`${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  let d = `M ${pts[0]}`;
  for (let i = 1; i < pts.length; i++) d += ` L ${pts[i]}`;
  if (crestOnly) return d;
  return `${d} L ${end.toFixed(1)} ${H} L ${start.toFixed(1)} ${H} Z`;
}

// Horizon (far, faint) → foreground (near, deep). Alternating drift directions
// give the parallax a living, criss-cross feel.
const LAYERS: WaveLayer[] = [
  { baseY: 250, amp: 7, wavelength: 440, phase: 0.0, fill: 'var(--wb-water-far)', driftDur: 30, dir: -1, delay: 0.05, foam: false },
  { baseY: 300, amp: 13, wavelength: 380, phase: 1.1, fill: 'var(--wb-water-1)', driftDur: 26, dir: 1, delay: 0.2, foam: true },
  { baseY: 360, amp: 19, wavelength: 320, phase: 2.0, fill: 'var(--wb-water-2)', driftDur: 21, dir: -1, delay: 0.35, foam: true },
  { baseY: 432, amp: 26, wavelength: 280, phase: 0.6, fill: 'var(--wb-water-3)', driftDur: 16, dir: 1, delay: 0.5, foam: true },
  { baseY: 514, amp: 34, wavelength: 240, phase: 1.7, fill: 'var(--wb-water-near)', driftDur: 12, dir: -1, delay: 0.65, foam: true },
];

function Wave({ layer, index }: { layer: WaveLayer; index: number }) {
  // Drift one wavelength then loop — seamless because the band repeats every λ.
  const driftClass = layer.dir === -1 ? 'wb-drift wb-drift-left' : 'wb-drift wb-drift-right';
  return (
    <g
      className={driftClass}
      style={{ ['--wb-drift' as string]: `${layer.wavelength}px`, animationDuration: `${layer.driftDur}s` }}
    >
      <g className="wb-emerge" style={{ animationDelay: `${layer.delay}s` }}>
        <path d={wavePath(layer)} fill={layer.fill} />
        {layer.foam && (
          <path
            d={wavePath(layer, true)}
            fill="none"
            stroke="var(--wb-foam)"
            strokeWidth={index >= 3 ? 3 : 2}
            strokeLinecap="round"
            opacity={0.55}
          />
        )}
      </g>
    </g>
  );
}

export default function WaveBackdrop({ className = '' }: { className?: string }) {
  return (
    <div className={`wb-scene ${className}`} aria-hidden="true">
      <svg className="wb-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMax slice" role="presentation">
        <defs>
          <linearGradient id="wb-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--wb-sky-top)" />
            <stop offset="100%" stopColor="var(--wb-sky-mid)" />
          </linearGradient>
          <radialGradient id="wb-sun" cx="50%" cy="36%" r="40%">
            <stop offset="0%" stopColor="var(--wb-sun)" stopOpacity="0.85" />
            <stop offset="100%" stopColor="var(--wb-sun)" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Sky + soft sun glow over the horizon */}
        <rect x="0" y="0" width={W} height={H} fill="url(#wb-sky)" />
        <rect x="0" y="0" width={W} height={H} fill="url(#wb-sun)" className="wb-sun" />

        {/* Drifting clouds near the horizon */}
        <g className="wb-clouds" fill="var(--wb-cloud)">
          <g className="wb-cloud wb-cloud-1">
            <ellipse cx="0" cy="120" rx="120" ry="22" />
            <ellipse cx="64" cy="110" rx="74" ry="18" />
            <ellipse cx="-64" cy="114" rx="64" ry="16" />
          </g>
          <g className="wb-cloud wb-cloud-2">
            <ellipse cx="0" cy="80" rx="84" ry="16" />
            <ellipse cx="54" cy="74" rx="54" ry="13" />
          </g>
        </g>

        {/* Birds */}
        <g className="wb-birds" stroke="var(--wb-bird)" strokeWidth="2.5" fill="none" strokeLinecap="round">
          <path className="wb-bird wb-bird-1" d="M0 0 q7 -8 14 0 q7 -8 14 0" />
          <path className="wb-bird wb-bird-2" d="M0 0 q5 -6 10 0 q5 -6 10 0" />
          <path className="wb-bird wb-bird-3" d="M0 0 q6 -7 12 0 q6 -7 12 0" />
        </g>

        {/* Wave bands, horizon → foreground */}
        {LAYERS.map((layer, i) => (
          <Wave key={i} layer={layer} index={i} />
        ))}
      </svg>
      {/* Fade the water's foot into the page background so the content below blends in. */}
      <div className="wb-fade" />
    </div>
  );
}
