'use client';

/**
 * WaveBackdrop — a first-person "rushing forward through water" hero, like the
 * view from a jetski: a bright open lane at the centre vanishing point (the path
 * ahead), with spray + wave streaks that emanate from that point and ZOOM
 * outward to the left and right, scaling up as they rush past the camera, while
 * waves splash up the side edges. Everything loops continuously and is phase-
 * staggered (negative animation-delays) so the motion is full from the first
 * frame. Inspired by the layered, into-the-screen perspective on contextqa.com,
 * rebuilt as an original SVG scene themed to the BuilderForce palette.
 *
 * Pure presentation: pointer-events: none, aria-hidden. The caller positions it
 * absolutely behind hero content. Motion is gated behind `prefers-reduced-motion`
 * in globals.css (calm static frame for those users).
 *
 * Geometry is generated deterministically (no Math.random) so server and client
 * render identically, avoiding hydration mismatch.
 */

const W = 1200;
const H = 600;
// Vanishing point — the bright lane ahead. Streaks fan OUT from here, downward
// to both sides, leaving the upper-centre open (the road you're heading into).
const VP_X = 600;
const VP_Y = 232;

interface Streak {
  /** Travel direction in degrees (x=cos, y=sin, y points down). */
  angle: number;
  /** End translation distance from the vanishing point (viewBox units). */
  dist: number;
  /** Scale at the end of the run (how big it gets as it passes the camera). */
  endScale: number;
  /** Loop duration (s). */
  dur: number;
  /** Negative start offset (s) so the field is full at t=0. */
  delay: number;
  /** Streak length/width character. */
  len: number;
  thick: number;
}

const STREAK_COUNT = 30;
const DIST = 840; // far enough to exit the viewBox from the vanishing point

// Two downward fans (down-right + down-left) keep the upper-centre lane clear.
const STREAKS: Streak[] = Array.from({ length: STREAK_COUNT }, (_, i) => {
  const side = i % 2; // 0 = right fan, 1 = left fan
  const k = Math.floor(i / 2);
  const half = STREAK_COUNT / 2;
  const t = k / (half - 1); // 0..1 across the fan
  // Right fan: 8°→88° (right & down). Left fan: 92°→172° (left & down).
  const angle = side === 0 ? 8 + t * 80 : 92 + t * 80;
  const wobble = Math.sin(i * 1.7); // deterministic variety
  return {
    angle,
    dist: DIST,
    endScale: 2.1 + t * 1.7 + Math.abs(wobble) * 0.4,
    dur: 3.0 + Math.abs(wobble) * 1.6,
    delay: -((i / STREAK_COUNT) * 4.2),
    len: 20 + Math.abs(wobble) * 14,
    thick: 4 + Math.abs(Math.cos(i * 0.9)) * 3,
  };
});

function StreakNode({ s }: { s: Streak }) {
  const rad = (s.angle * Math.PI) / 180;
  const tx = (Math.cos(rad) * s.dist).toFixed(1);
  const ty = (Math.sin(rad) * s.dist).toFixed(1);
  return (
    <g transform={`translate(${VP_X} ${VP_Y})`}>
      <g
        className="wb-streak"
        style={{
          ['--tx' as string]: `${tx}px`,
          ['--ty' as string]: `${ty}px`,
          ['--es' as string]: `${s.endScale}`,
          animationDuration: `${s.dur}s`,
          animationDelay: `${s.delay}s`,
        }}
      >
        {/* Oriented along travel so it reads as a motion streak of spray. */}
        <g transform={`rotate(${s.angle.toFixed(1)})`}>
          <ellipse cx={s.len * 0.3} cy="0" rx={s.len} ry={s.thick} fill="var(--wb-band)" />
          <ellipse cx={s.len * 0.55} cy="0" rx={s.len * 0.5} ry={s.thick * 0.55} fill="var(--wb-foam)" opacity={0.85} />
        </g>
      </g>
    </g>
  );
}

export default function WaveBackdrop({ className = '' }: { className?: string }) {
  return (
    <div className={`wb-scene ${className}`} aria-hidden="true">
      <svg className="wb-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" role="presentation">
        <defs>
          {/* Depth tunnel: bright open lane at the vanishing point → deep water edges */}
          <radialGradient id="wb-depth" cx="50%" cy="39%" r="78%">
            <stop offset="0%" stopColor="var(--wb-glow)" />
            <stop offset="42%" stopColor="var(--wb-water-far)" />
            <stop offset="100%" stopColor="var(--wb-water-near)" />
          </radialGradient>
          <radialGradient id="wb-sun" cx="50%" cy="39%" r="34%">
            <stop offset="0%" stopColor="var(--wb-glow)" stopOpacity="0.95" />
            <stop offset="100%" stopColor="var(--wb-glow)" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="wb-splash-l" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--wb-foam)" stopOpacity="0.55" />
            <stop offset="100%" stopColor="var(--wb-foam)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="wb-splash-r" x1="1" y1="0" x2="0" y2="0">
            <stop offset="0%" stopColor="var(--wb-foam)" stopOpacity="0.55" />
            <stop offset="100%" stopColor="var(--wb-foam)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Water + bright centre lane */}
        <rect x="0" y="0" width={W} height={H} fill="url(#wb-depth)" />
        <rect x="0" y="0" width={W} height={H} fill="url(#wb-sun)" className="wb-sun" />

        {/* Streaks rushing outward from the vanishing point */}
        <g className="wb-field">
          {STREAKS.map((s, i) => (
            <StreakNode key={i} s={s} />
          ))}
        </g>

        {/* Waves splashing up the side edges */}
        <g className="wb-splash wb-splash-left">
          <path d="M0 600 Q 70 430 30 300 Q 10 200 70 120 L 0 120 Z" fill="url(#wb-splash-l)" />
        </g>
        <g className="wb-splash wb-splash-right">
          <path d="M1200 600 Q 1130 430 1170 300 Q 1190 200 1130 120 L 1200 120 Z" fill="url(#wb-splash-r)" />
        </g>
      </svg>
      {/* Fade the foot of the scene into the page background so content blends in. */}
      <div className="wb-fade" />
    </div>
  );
}
