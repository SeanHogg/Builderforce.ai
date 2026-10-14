import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui';
import { PackList } from './PackList';
import type { SetupStepProps } from './setupSteps';
import styles from './capability.module.css';

/** Step 5 — the free allowance, or a pack (D4); either way into the app. */
export function PlanStep({ app, onDone }: SetupStepProps) {
  const t = useTranslations('marketplace.capability.plan');
  return (
    <div className={styles.stack}>
      <p className={styles.body}>{t('lead')}</p>
      <PackList appPath={app.homePath} />
      <Button variant="primary" onClick={() => onDone()} data-testid="setup-finish">{t('startFree')}</Button>
    </div>
  );
}
