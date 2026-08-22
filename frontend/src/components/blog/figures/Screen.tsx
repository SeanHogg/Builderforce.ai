import styles from './figures.module.css';
import { hueOf, type ScreenFigure } from './types';

/**
 * A picture of an interface — named regions on a frame.
 *
 * Drawn, not screenshotted. A screenshot ages the day the product moves, ships
 * whatever data happened to be on screen, and is one flat image shown into two
 * themes; this is tokens and geometry, so it reads in both and a region that
 * moves is a number in a markdown file.
 *
 * The coordinate space is the frame itself: 0–100 across and 0–100 down, which
 * is how a layout is described out loud ("the bar runs across the bottom
 * eighth"). A fixed viewBox with a fluid width means it scales to its column
 * rather than needing a breakpoint.
 */
export default function Screen({ spec }: { spec: ScreenFigure }) {
  const W = 1000;
  const H = Math.round(W / (spec.ratio ?? 1.6));
  const BAR = spec.frame ? 46 : 0;
  const x = (v: number) => (v / 100) * W;
  const y = (v: number) => BAR + (v / 100) * (H - BAR);
  const h = (v: number) => (v / 100) * (H - BAR);

  return (
    <div className={styles.scroll}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className={styles.screen}
        role="img"
        aria-label={spec.title ?? spec.frame ?? 'Interface layout'}
      >
        <rect x="1" y="1" width={W - 2} height={H - 2} rx="18" fill="var(--bg-elevated)" stroke="var(--border)" strokeWidth="2" />

        {spec.frame && (
          <>
            <line x1="1" y1={BAR} x2={W - 1} y2={BAR} stroke="var(--border)" strokeWidth="2" />
            <g fill="var(--text-muted)">
              <circle cx="28" cy={BAR / 2} r="6" />
              <circle cx="50" cy={BAR / 2} r="6" />
              <circle cx="72" cy={BAR / 2} r="6" />
            </g>
            <text x="96" y={BAR / 2 + 6} fill="var(--text-secondary)" fontSize="18" fontFamily="var(--font-display)" fontWeight="650">
              {spec.frame}
            </text>
          </>
        )}

        {spec.regions.map((region) => {
          const hue = hueOf(region.hue);
          const ghost = region.style === 'ghost';
          const rh = h(region.h);
          // A short region gets its label on the centre line and no note; there
          // is no room for two rows of type and a clipped second line reads as
          // a rendering bug rather than as a full box.
          const roomForNote = rh > 74 && Boolean(region.note);
          const cx = x(region.x) + x(region.w) / 2;
          const cy = y(region.y) + rh / 2;
          return (
            <g key={`${region.label}-${region.x}-${region.y}`}>
              <rect
                x={x(region.x)}
                y={y(region.y)}
                width={x(region.w)}
                height={rh}
                rx="12"
                fill={ghost ? 'none' : hue}
                fillOpacity={ghost ? 0 : 0.16}
                stroke={ghost ? 'var(--text-muted)' : hue}
                strokeWidth="2"
                strokeDasharray={ghost ? '10 8' : undefined}
              />
              <text
                x={cx}
                y={roomForNote ? cy - 6 : cy + 6}
                textAnchor="middle"
                fill={ghost ? 'var(--text-muted)' : 'var(--text-primary)'}
                fontSize="19"
                fontWeight="700"
                fontFamily="var(--font-display)"
              >
                {region.label}
              </text>
              {roomForNote && (
                <text x={cx} y={cy + 22} textAnchor="middle" fill="var(--text-secondary)" fontSize="15" fontFamily="var(--font-display)">
                  {region.note}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
