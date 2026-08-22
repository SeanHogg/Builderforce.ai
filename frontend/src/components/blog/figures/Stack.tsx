import type React from 'react';
import styles from './figures.module.css';
import { hueOf, type StackFigure } from './types';

/** A ladder — one band per stage, each with its own rule down the side. */
export default function Stack({ spec }: { spec: StackFigure }) {
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
