import styles from './BlogFigure.module.css';

/**
 * BlogFigure — the figure vocabulary for blog posts.
 *
 * ── WHY THIS EXISTS AND NOT RAW HTML ────────────────────────────────────────
 * Posts are markdown rendered by `<ReactMarkdown>` through the ONE shared
 * pipeline (`lib/markdownPipeline`), which deliberately has no `rehype-raw`.
 * That is correct and must stay correct: the same pipeline renders chat
 * messages, canvas cards and imported documents, so enabling raw HTML for the
 * blog would enable it for every string a user can put in front of another
 * user. An `<svg onload>` in a shared canvas note is not a hypothetical.
 *
 * So a figure is DATA, not markup. A post writes a fenced block:
 *
 *     ```bf-figure
 *     { "kind": "flow", "title": "…", "steps": [ … ] }
 *     ```
 *
 * and this renders it. Five kinds, chosen because they are the five shapes the
 * product's own ideas actually have — a sequence, a trade-off, a ladder, a
 * ranking and a contrast — rather than five chart types looking for a use. A
 * sixth is a case in this switch plus a block in the stylesheet; it is not a
 * post embedding markup.
 *
 * Every colour is a token, so a figure is legible in both themes, and every
 * width is fluid or scrolls inside its own container, so a wide figure never
 * makes the page scroll sideways.
 *
 * No `'use client'`: this holds no state and calls no hook. Its only consumer
 * is the post renderer, which is already a client component, so the directive
 * would add a file to the client-boundary ratchet and buy nothing.
 */

/** Hues a figure may name. An allow-list rather than a free string: an
 *  undeclared custom property drops the declaration that uses it, silently and
 *  in both themes, and a typo in a markdown file is exactly the place nobody
 *  would look for a missing colour. */
const HUES = {
  idea: 'var(--stage-idea)',
  make: 'var(--stage-make)',
  run: 'var(--stage-run)',
  measure: 'var(--stage-measure)',
  market: 'var(--stage-market)',
  expand: 'var(--stage-expand)',
  read: 'var(--stage-read)',
  prove: 'var(--stage-prove)',
  build: 'var(--stage-buildWith)',
  accent: 'var(--coral-bright)',
  good: 'var(--success)',
  bad: 'var(--danger)',
  muted: 'var(--text-muted)',
} as const;

export type FigureHue = keyof typeof HUES;

const hueOf = (hue?: string): string => HUES[(hue ?? 'accent') as FigureHue] ?? HUES.accent;

interface FigureBase {
  title?: string;
  caption?: string;
}

/** A sequence — Read → Prove → Build, or any ordered set of acts. */
interface FlowFigure extends FigureBase {
  kind: 'flow';
  steps: Array<{ label: string; note?: string; hue?: FigureHue; tag?: string }>;
}

/** A trade-off on two axes. `dx`/`dy` nudge a LABEL, never its point — two
 *  proofs genuinely sit on the same coordinates and the author, not a collision
 *  heuristic, decides which way each name leans. */
interface MatrixFigure extends FigureBase {
  kind: 'matrix';
  xLabel: string;
  yLabel: string;
  /** Axis extent. Both axes share it; the product's own meters are 1–5. */
  max?: number;
  points: Array<{ label: string; x: number; y: number; hue?: FigureHue; dx?: number; dy?: number }>;
}

/** A ladder — stages of an arc, each with a question. */
interface StackFigure extends FigureBase {
  kind: 'stack';
  bands: Array<{ label: string; note?: string; hue?: FigureHue; tag?: string }>;
}

/** A ranking with a value track. */
interface BarsFigure extends FigureBase {
  kind: 'bars';
  max?: number;
  rows: Array<{ label: string; value: number; note?: string; hue?: FigureHue }>;
}

/** A contrast — what people do, against what the method does. */
interface CompareFigure extends FigureBase {
  kind: 'compare';
  columns: Array<{ title: string; hue?: FigureHue; items: string[] }>;
}

export type FigureSpec = FlowFigure | MatrixFigure | StackFigure | BarsFigure | CompareFigure;

/** Parse a fenced block's body. A malformed figure returns null and the caller
 *  falls back to rendering the block as code — a post with a typo shows its
 *  source rather than a blank space where an argument used to be. */
export function parseFigure(source: string): FigureSpec | null {
  try {
    const parsed = JSON.parse(source) as FigureSpec;
    if (!parsed || typeof parsed !== 'object' || !('kind' in parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function Flow({ spec }: { spec: FlowFigure }) {
  return (
    <ol className={styles.flow}>
      {spec.steps.map((step, index) => (
        <li key={step.label} className={styles.flowStep} style={{ '--hue': hueOf(step.hue) } as React.CSSProperties}>
          <span className={styles.flowIndex}>{String(index + 1).padStart(2, '0')}</span>
          <strong>{step.label}</strong>
          {step.note && <span className={styles.flowNote}>{step.note}</span>}
          {step.tag && <span className={styles.tag}>{step.tag}</span>}
        </li>
      ))}
    </ol>
  );
}

function Matrix({ spec }: { spec: MatrixFigure }) {
  const max = spec.max ?? 5;
  // A fixed viewBox with a fluid width: the figure scales to its column instead
  // of needing a breakpoint, and the text scales with it.
  const W = 560;
  const H = 380;
  const PAD = { left: 62, right: 22, top: 20, bottom: 52 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const px = (x: number) => PAD.left + ((x - 1) / (max - 1)) * plotW;
  const py = (y: number) => PAD.top + plotH - ((y - 1) / (max - 1)) * plotH;
  const ticks = Array.from({ length: max }, (_, i) => i + 1);

  return (
    <div className={styles.scroll}>
      <svg viewBox={`0 0 ${W} ${H}`} className={styles.matrix} role="img" aria-label={spec.title ?? `${spec.yLabel} against ${spec.xLabel}`}>
        {/* Grid. Drawn from the tick list so the axes cannot disagree with it. */}
        <g stroke="var(--border-subtle)" strokeWidth="1">
          {ticks.map((t) => (
            <line key={`v${t}`} x1={px(t)} y1={PAD.top} x2={px(t)} y2={PAD.top + plotH} />
          ))}
          {ticks.map((t) => (
            <line key={`h${t}`} x1={PAD.left} y1={py(t)} x2={PAD.left + plotW} y2={py(t)} />
          ))}
        </g>

        {/* Tick numbers */}
        <g fill="var(--text-muted)" fontSize="11" fontFamily="var(--font-display)">
          {ticks.map((t) => (
            <text key={`xt${t}`} x={px(t)} y={PAD.top + plotH + 18} textAnchor="middle">{t}</text>
          ))}
          {ticks.map((t) => (
            <text key={`yt${t}`} x={PAD.left - 10} y={py(t) + 4} textAnchor="end">{t}</text>
          ))}
        </g>

        {/* Axis names */}
        <text x={PAD.left + plotW / 2} y={H - 14} textAnchor="middle" fill="var(--text-secondary)" fontSize="12" fontWeight="700" fontFamily="var(--font-display)">
          {spec.xLabel}
        </text>
        <text x={14} y={PAD.top + plotH / 2} textAnchor="middle" fill="var(--text-secondary)" fontSize="12" fontWeight="700" fontFamily="var(--font-display)" transform={`rotate(-90 14 ${PAD.top + plotH / 2})`}>
          {spec.yLabel}
        </text>

        {/* Points */}
        {spec.points.map((point) => {
          const cx = px(point.x);
          const cy = py(point.y);
          const hue = hueOf(point.hue);
          const dx = point.dx ?? 10;
          const dy = point.dy ?? -10;
          return (
            <g key={point.label}>
              <circle cx={cx} cy={cy} r="7" fill={hue} fillOpacity="0.22" stroke={hue} strokeWidth="2" />
              <text
                x={cx + dx}
                y={cy + dy}
                textAnchor={dx < 0 ? 'end' : 'start'}
                fill="var(--text-primary)"
                fontSize="12"
                fontWeight="650"
                fontFamily="var(--font-display)"
              >
                {point.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function Stack({ spec }: { spec: StackFigure }) {
  return (
    <ol className={styles.stack}>
      {spec.bands.map((band) => (
        <li key={band.label} className={styles.band} style={{ '--hue': hueOf(band.hue) } as React.CSSProperties}>
          <span className={styles.bandRule} aria-hidden="true" />
          <span className={styles.bandBody}>
            <strong>{band.label}</strong>
            {band.note && <span>{band.note}</span>}
          </span>
          {band.tag && <span className={styles.tag}>{band.tag}</span>}
        </li>
      ))}
    </ol>
  );
}

function Bars({ spec }: { spec: BarsFigure }) {
  const max = spec.max ?? Math.max(...spec.rows.map((r) => r.value), 1);
  return (
    <ul className={styles.bars}>
      {spec.rows.map((row) => (
        <li key={row.label} className={styles.bar} style={{ '--hue': hueOf(row.hue) } as React.CSSProperties}>
          <span className={styles.barLabel}>{row.label}</span>
          <span className={styles.barTrack}>
            <span
              className={styles.barFill}
              style={{ width: `${Math.max(2, Math.min(100, (row.value / max) * 100))}%` }}
              role="img"
              aria-label={`${row.label}: ${row.value} of ${max}`}
            />
          </span>
          <span className={styles.barValue}>{row.note ?? row.value}</span>
        </li>
      ))}
    </ul>
  );
}

function Compare({ spec }: { spec: CompareFigure }) {
  return (
    <div className={styles.compare}>
      {spec.columns.map((column) => (
        <div key={column.title} className={styles.compareCol} style={{ '--hue': hueOf(column.hue) } as React.CSSProperties}>
          <strong>{column.title}</strong>
          <ul>
            {column.items.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      ))}
    </div>
  );
}

export default function BlogFigure({ spec }: { spec: FigureSpec }) {
  return (
    <figure className={styles.figure}>
      {spec.title && <p className={styles.title}>{spec.title}</p>}
      {spec.kind === 'flow' && <Flow spec={spec} />}
      {spec.kind === 'matrix' && <Matrix spec={spec} />}
      {spec.kind === 'stack' && <Stack spec={spec} />}
      {spec.kind === 'bars' && <Bars spec={spec} />}
      {spec.kind === 'compare' && <Compare spec={spec} />}
      {spec.caption && <figcaption className={styles.caption}>{spec.caption}</figcaption>}
    </figure>
  );
}
