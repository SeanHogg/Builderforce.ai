'use client';

import { useTranslations } from 'next-intl';
import { METHOD_STAGES } from '@/lib/methodology';
import type { Stage } from '@/lib/navGroups';
import styles from './StageHeaderSwitcher.module.css';

/**
 * The founder's journey — Idea / Make / Run / Measure — as the panel header's
 * own control (PRD: "Idea to Real"). Published by a page via
 * `chrome.stage` + `usePublishStageSelect` (see `lib/referenceChrome.tsx`) and
 * rendered by `ShellPanel`, so it lives in `components/shell/` rather than
 * `components/dashboard/`: any destination that names a stage gets the same
 * control, not just the dashboard that happens to be the first.
 *
 * `activeStage` is which stage's menu the rail is showing (a click here
 * changes it); `currentStage` is the tenant's actual journey position — the
 * two differ the moment somebody browses a stage they have not reached yet.
 */
export function StageHeaderSwitcher({ activeStage, currentStage, onSelect }: {
  activeStage: Stage;
  currentStage?: Stage | null;
  onSelect: (stage: Stage) => void;
}) {
  const t = useTranslations('nav');
  return (
    <nav className={styles.rail} aria-label={t('journey.label')}>
      {METHOD_STAGES.map((stage) => (
        <button
          key={stage}
          type="button"
          className={styles.cell}
          data-stage={stage}
          data-active={activeStage === stage}
          aria-current={currentStage === stage ? 'step' : undefined}
          onClick={() => onSelect(stage)}
        >
          <span className={styles.dot} aria-hidden="true" />
          {t(`stage.${stage}`)}
        </button>
      ))}
    </nav>
  );
}
