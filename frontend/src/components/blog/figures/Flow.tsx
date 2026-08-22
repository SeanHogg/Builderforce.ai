import type React from 'react';
import styles from './figures.module.css';
import { hueOf, type FlowFigure } from './types';

/** A sequence, numbered, each step carrying its own hue. */
export default function Flow({ spec }: { spec: FlowFigure }) {
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
