import { useState } from 'react';
import Link from 'next/link';
import styles from './ArchitectureAnalysisButton.module.css';

export function ArchitectureAnalysisButton() {
  const [showAnalysis, setShowAnalysis] = useState(false);

  const toggleAnalysis = () => {
    setShowAnalysis((prev) => !prev);
    const analysisId = document.getElementById('architecture-analysis');
    if (analysisId) {
      analysisId.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <Link href="#architecture-analysis" className={styles.link}>
      <button
        type="button"
        onClick={toggleAnalysis}
        aria-pressed={showAnalysis}
        className={styles.button}
      >
        <span className={styles.icon}>🔌</span>
        <span className={styles.label}>Analyze architecture</span>
      </button>
    </Link>
  );
}