import styles from './figures.module.css';
import { hueOf, type MatrixFigure } from './types';

/**
 * A trade-off on two axes.
 *
 * A fixed viewBox with a fluid width: the figure scales to its column instead of
 * needing a breakpoint, and the text scales with it.
 */
export default function Matrix({ spec }: { spec: MatrixFigure }) {
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
