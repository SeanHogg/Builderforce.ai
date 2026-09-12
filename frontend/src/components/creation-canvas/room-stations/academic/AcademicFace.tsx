import styles from './academicStations.module.css';

/**
 * What an academic station's stand shows on its face: one figure, one sentence, and up
 * to three lines. Pure DOM with every word handed in — the face renders in a root with
 * no React context (see `room-stations/types.ts`), so it cannot translate anything.
 */
export function AcademicFace({ figure, headline, lines, tone }: {
  figure: string;
  headline: string;
  lines: readonly string[];
  tone: 'calm' | 'attention';
}) {
  return (
    <div className={styles.face} data-tone={tone}>
      <strong className={styles.faceFigure}>{figure}</strong>
      <p className={styles.faceHeadline}>{headline}</p>
      {lines.length > 0 && (
        <ul className={styles.faceList}>
          {lines.map((line, index) => <li key={`${line}-${index}`}>{line}</li>)}
        </ul>
      )}
    </div>
  );
}
