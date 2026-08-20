/**
 * WhyChainChart — the 5-Why ladder as a picture: problem → why₁ → … → root cause.
 *
 * WHY THIS EXISTS ALONGSIDE THE FISHBONE. The fishbone answers "what CATEGORIES of
 * cause were involved" and is deliberately unordered — bones do not point at each
 * other. A 5-Why is the opposite claim: each step is an ANSWER to the one above it,
 * and the sequence is the entire content. Drawing a chain as bones throws that away,
 * which is exactly what the incidents surface used to do (it split a textarea on
 * newlines and hung the fragments off a spine). Both diagrams stay; where a chain
 * exists it leads, because it says more.
 *
 * WHY DOM AND NOT INLINE SVG, unlike its siblings in this folder. SVG text does not
 * reflow: a viewBox wide enough for a sentence renders that sentence at ~6px on a
 * 360px phone, which is the width an on-call responder actually reads a post-mortem
 * on. The steps are also genuinely a LIST, so `role="list"` + one `listitem` per rung
 * lets a screen reader walk the chain instead of hearing a single aria-label blob.
 * Theme tokens throughout — the rule the chart folder actually shares.
 */

import { colorAt } from './chartColors';

export interface WhyChainStep {
  /** 1-based depth. */
  stepNo: number;
  statement: string;
  /** The terminal step: the cause remediation attaches to. At most one. */
  isRoot?: boolean;
}

export interface WhyChainChartProps {
  /** The effect under analysis — the top of the ladder (usually the incident title). */
  problem: string;
  steps: WhyChainStep[];
  /** Accessible name for the whole chain. */
  ariaLabel: string;
  /** Localized label for the problem row (e.g. "Problem"). */
  problemLabel: string;
  /** Localized `why {n}` renderer for each rung's caption. */
  stepLabel: (stepNo: number) => string;
  /** Localized badge on the terminal step (e.g. "Root cause"). */
  rootLabel: string;
}

/** Indent per rung, capped so a seven-step chain still fits a 360px viewport. */
const INDENT_PER_STEP = 14;
const MAX_INDENT = 70;

export function WhyChainChart({ problem, steps, ariaLabel, problemLabel, stepLabel, rootLabel }: WhyChainChartProps) {
  const accent = colorAt(1);
  const rootAccent = colorAt(4);

  return (
    <div role="list" aria-label={ariaLabel} style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
      <Rung
        role="listitem"
        indent={0}
        caption={problemLabel}
        text={problem}
        accent="var(--text-secondary)"
        emphasis
      />
      {steps.map((s, i) => (
        <Rung
          key={s.stepNo}
          role="listitem"
          indent={Math.min((i + 1) * INDENT_PER_STEP, MAX_INDENT)}
          caption={stepLabel(s.stepNo)}
          text={s.statement}
          accent={s.isRoot ? rootAccent : accent}
          badge={s.isRoot ? rootLabel : undefined}
          emphasis={s.isRoot === true}
        />
      ))}
    </div>
  );
}

function Rung({
  role, indent, caption, text, accent, badge, emphasis,
}: {
  role: string;
  indent: number;
  caption: string;
  text: string;
  accent: string;
  badge?: string;
  emphasis?: boolean;
}) {
  return (
    <div role={role} style={{ display: 'flex', gap: 8, marginInlineStart: indent, minWidth: 0 }}>
      {/* The step marker doubles as the connector: a left rule in the rung's own
          accent, so the ladder reads as a chain without an SVG to draw one. */}
      <span aria-hidden="true" style={{ width: 3, borderRadius: 2, background: accent, flex: '0 0 auto' }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
            {caption}
          </span>
          {badge && (
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 'var(--radius-sm)',
              color: accent, border: `1px solid ${accent}`,
            }}>
              {badge}
            </span>
          )}
        </div>
        <span style={{
          fontSize: 13,
          fontWeight: emphasis ? 700 : 500,
          color: 'var(--text-primary)',
          overflowWrap: 'anywhere',
        }}>
          {text}
        </span>
      </div>
    </div>
  );
}
