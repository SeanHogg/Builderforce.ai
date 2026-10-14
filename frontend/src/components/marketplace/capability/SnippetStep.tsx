import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui';
import { SnippetTabs } from './SnippetTabs';
import type { SetupStepProps } from './setupSteps';
import styles from './capability.module.css';

/** Step 3 — paste the loader (or nothing, for a hosted app), then verify it. */
export function SnippetStep({ site, onDone }: SetupStepProps) {
  const t = useTranslations('marketplace.capability.snippet');
  if (!site) return null;
  return (
    <div className={styles.stack}>
      <p className={styles.body}>{site.kind === 'hosted' ? t('hostedLead') : t('lead')}</p>
      <SnippetTabs site={site} />
      <Button variant="primary" onClick={() => onDone()} data-testid="setup-snippet-next">{t('next')}</Button>
    </div>
  );
}
