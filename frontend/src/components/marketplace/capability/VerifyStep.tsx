import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui';
import { CapabilityVerify, isInstalled } from './CapabilityVerify';
import type { SetupStepProps } from './setupSteps';
import styles from './capability.module.css';

/** Step 4 — the live checks; continues only once the install has proved itself. */
export function VerifyStep({ site, onDone }: SetupStepProps) {
  const t = useTranslations('marketplace.capability.verify');
  const [installed, setInstalled] = useState(false);
  if (!site) return null;
  return (
    <div className={styles.stack}>
      <p className={styles.body}>{t('lead')}</p>
      <CapabilityVerify siteId={site.id} onResult={(verify) => setInstalled(isInstalled(verify))} />
      <Button variant="primary" disabled={!installed} onClick={() => onDone()} data-testid="setup-verify-next">{t('next')}</Button>
    </div>
  );
}
