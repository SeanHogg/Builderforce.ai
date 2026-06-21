'use client';

/**
 * WaveBackdrop — a layered ocean that continuously FLOWS toward the viewer:
 * translucent wave bands rise at the horizon, then march down + scale up + fade
 * as they sweep past the camera, recycling in a seamless loop. Bands are phase-
 * staggered (negative animation-delays) so the flow is dense and alive from the
 * first frame — "see clarity through the storm". Inspired by the layered, into-
 * the-screen motion on contextqa.com, rebuilt as an original SVG scene themed to
 * the BuilderForce palette so it works on light and dark.
 *
 * Pure presentation: pointer-events: none, aria-hidden. The caller positions it
 * absolutely behind hero content. All motion is gated behind
 * `prefers-reduced-motion` in globals.css — reduced-motion users get a calm,
 * static sea with no animation.
 *
 * Geometry is generated deterministically (no Math.random) so server and client
 * render identically, avoiding hydration mismatch.
 */

const W = 1200;
const H = 600;
const HORIZON = 250;

/** A wave band's per-instance character (shape only — motion comes from CSS). */
interface Band {
  amp: number;
  wavelength: number;
  phase: number;
  depth: number;
  /** Drift duration (s) for the gentle horizontal sway nested inside the flow. */
  swayDur: number;
  /** Sway start offset so bands don't sway in lockstep. */
  swayDelay: number;
}

const BAND_COUNT = 9;
const FLOW_DURATION = 11; // seconds for one back-to-front sweep

// Deterministic, varied bands. Wavelength/phase vary so crests never line up.
const BANDS: Band[] = Array.from({ length: BAND_COUNT }, (_, i) => {
  const f = Math.sin(i * 2.4);
  return {
    amp: 16 + Math.abs(f) * 12,
    wavelength: 300 + ((i * 67) % 180),
    phase: i * 0.8,
    depth: 320,
    swayDur: 6 + (i % 4) * 1.3,
    swayDelay: -(i * 0.9),
  };
});

/** A wave crest sampled across [-λ, W+λ] (extra both sides for the sway), closed
 *  down `depth` units below the crest into a filled band. `crestOnly` returns the
 *  open crest polyline for the foam highlight. */
function bandPath(b: Band, crestOnly = false): string {
  const start = -b.wavelength;
  const end = W + b.wavelength;
  const step = b.wavelength / 14;
  const pts: string[] = [];
  for (let x = start; x <= end; x += step) {
    const y = HORIZON + b.amp * Math.sin((2 * Math.PI * x) / b.wavelength + b.phase);
    pts.push(`${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  let d = `M ${pts[0]}`;
  for (let i = 1; i < pts.length; i++) d += ` L ${pts[i]}`;
  if (crestOnly) return d;
  return `${d} L ${end.toFixed(1)} ${(HORIZON + b.depth).toFixed(1)} L ${start.toFixed(1)} ${(HORIZON + b.depth).toFixed(1)} Z`;
}

function WaveBand({ band, index }: { band: Band; index: number }) {
  // Negative delay starts each band mid-sweep → the flow is full from frame 1.
  const flowDelay = -(index * (FLOW_DURATION / BAND_COUNT));
  return (
    <g
      className="wb-band"
      style={{ animationDuration: `${FLOW_DURATION}s`, animationDelay: `${flowDelay}s` }}
    >
      <g
        className="wb-sway"
        style={{ animationDuration: `${band.swayDur}s`, animationDelay: `${band.swayDelay}s` }}
      >
        <path d={bandPath(band)} fill="var(--wb-band)" />
        <path d={bandPath(band, true)} fill="none" stroke="var(--wb-foam)" strokeWidth={2.5} strokeLinecap="round" opacity={0.7} />
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
          <linearGradient id="wb-sea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--wb-water-far)" />
            <stop offset="100%" stopColor="var(--wb-water-near)" />
          </linearGradient>
          <radialGradient id="wb-sun" cx="50%" cy="34%" r="42%">
            <stop offset="0%" stopColor="var(--wb-sun)" stopOpacity="0.85" />
            <stop offset="100%" stopColor="var(--wb-sun)" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Sky + sun glow over the horizon */}
        <rect x="0" y="0" width={W} height={H} fill="url(#wb-sky)" />
        <rect x="0" y="0" width={W} height={H} fill="url(#wb-sun)" className="wb-sun" />

        {/* Static sea base (far → near depth gradient) the flowing bands ride over */}
        <rect x="0" y={HORIZON} width={W} height={H - HORIZON} fill="url(#wb-sea)" />

        {/* Drifting clouds near the horizon */}
        <g className="wb-clouds" fill="var(--wb-cloud)">
          <g className="wb-cloud wb-cloud-1">
            <ellipse cx="0" cy="110" rx="120" ry="22" />
            <ellipse cx="64" cy="100" rx="74" ry="18" />
            <ellipse cx="-64" cy="104" rx="64" ry="16" />
          </g>
          <g className="wb-cloud wb-cloud-2">
            <ellipse cx="0" cy="70" rx="84" ry="16" />
            <ellipse cx="54" cy="64" rx="54" ry="13" />
          </g>
        </g>

        {/* Birds */}
        <g className="wb-birds" stroke="var(--wb-bird)" strokeWidth="2.5" fill="none" strokeLinecap="round">
          <path className="wb-bird wb-bird-1" d="M0 0 q7 -8 14 0 q7 -8 14 0" />
          <path className="wb-bird wb-bird-2" d="M0 0 q5 -6 10 0 q5 -6 10 0" />
          <path className="wb-bird wb-bird-3" d="M0 0 q6 -7 12 0 q6 -7 12 0" />
        </g>

        {/* Wave bands flowing horizon → foreground, into the screen */}
        <g className="wb-flow-group">
          {BANDS.map((band, i) => (
            <WaveBand key={i} band={band} index={i} />
          ))}
        </g>
      </svg>
      {/* Fade the water's foot into the page background so the content below blends in. */}
      <div className="wb-fade" />
    </div>
  );
}
