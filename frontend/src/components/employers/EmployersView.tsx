'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { EmployerDirectory } from './EmployerDirectory';
import { EmployerReviewPanel } from './EmployerReviewPanel';
import { ReviewModerationQueue } from './ReviewModerationQueue';
import styles from './employers.module.css';

/**
 * The composed Employers surface: pick one on the left, read and review it on
 * the right, with the moderation queue underneath for whoever may work it.
 *
 * The ONE piece of state is which employer is selected, and it lives here because
 * it is the only thing the two panels share. Everything else — the directory's
 * search, the panel's form, the queue's entitlement — belongs to the component
 * that owns it, so this file does not grow when any of them does.
 *
 * `ReviewModerationQueue` renders nothing at all for a member who cannot
 * moderate, and nothing when the queue is empty, so there is no condition here
 * about who may see it.
 */
export function EmployersView() {
  const t = useTranslations('employers');
  const [selectedId, setSelectedId] = useState<number | null>(null);

  return (
    <div>
      <p className={styles.cardHint}>{t('view.intro')}</p>
      <div className={styles.grid}>
        <EmployerDirectory selectedId={selectedId} onSelect={(e) => setSelectedId(e.id)} />
        {selectedId !== null && <EmployerReviewPanel employerId={selectedId} />}
        <ReviewModerationQueue />
      </div>
    </div>
  );
}
