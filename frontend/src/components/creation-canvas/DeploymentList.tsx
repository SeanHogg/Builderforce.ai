// No 'use client' directive: every importer sits inside the `CreationCanvas` boundary.
import { useLocale, useTranslations } from 'next-intl';
import type { BoardDeployment } from '@/lib/canvas/boardDeployments';
import styles from './DeploymentList.module.css';

/**
 * THE DEPLOYMENTS LIST — environment, version, address and when, newest first.
 *
 * One component for both places a session's deployments are read: the Operate surface
 * and the room's ops station panel. The address is an external link; a deployment with
 * no address says it is planned rather than pretending to be live (`isLiveDeployment`).
 */
export function DeploymentList({ deployments }: { deployments: readonly BoardDeployment[] }) {
  const t = useTranslations('creationCanvas.operate');
  const locale = useLocale();
  const when = (iso: string | null) => {
    if (!iso) return null;
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? null : new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  };
  return (
    <ul className={styles.list} data-testid="deployment-list">
      {deployments.map((deployment) => {
        const deployedAt = when(deployment.deployedAt);
        return (
          <li key={deployment.id} className={styles.item} data-live={deployment.url ? 'true' : 'false'}>
            <span className={styles.env}>{deployment.environment || deployment.title || t('unnamedEnvironment')}</span>
            {deployment.version && <span className={styles.version}>{deployment.version}</span>}
            {deployment.url
              ? <a className={styles.url} href={deployment.url} target="_blank" rel="noreferrer noopener">{deployment.url}</a>
              : <span className={styles.planned}>{t('noAddress')}</span>}
            {deployedAt && <span className={styles.meta}>{t('deployedAt', { when: deployedAt })}</span>}
          </li>
        );
      })}
    </ul>
  );
}
