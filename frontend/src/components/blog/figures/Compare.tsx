import type React from 'react';
import styles from './figures.module.css';
import { hueOf, type CompareFigure } from './types';

/** A contrast — columns of items, one hue each. */
export default function Compare({ spec }: { spec: CompareFigure }) {
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
