import type React from 'react';
import styles from './figures.module.css';
import { hueOf, type BarsFigure } from './types';

/** A ranking with a value track. */
export default function Bars({ spec }: { spec: BarsFigure }) {
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
