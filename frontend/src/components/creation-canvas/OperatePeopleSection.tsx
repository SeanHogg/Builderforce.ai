// No 'use client' directive: rendered only inside `CanvasOperateSurface` (inside `CreationCanvas`, which declares it).
import { useTranslations } from 'next-intl';
import { useFormat } from '@/i18n/useFormat';
import { useSiteAudience } from './hooks/useSiteAudience';
import styles from './CreationCanvas.module.css';

export interface OperatePeopleSectionProps {
  /** The primary app's durable project (`binding.ideProjectId`), or null before there is one. */
  projectId: number | null;
}

/**
 * Operate → PEOPLE: who the published app reached — end users, new sign-ups, visitors,
 * page views and leads — read from what the platform already records for the site
 * (`site_users`, `site_traffic_daily`, `site_collections`) through ONE summary route.
 *
 * Self-contained: it owns its fetch (`useSiteAudience`) and decides its own copy. With no
 * durable project, or a project that is not published, it says how to get here and shows
 * nothing else — a row of zeros would read as "nobody came", which is not what happened.
 */
export function OperatePeopleSection({ projectId }: OperatePeopleSectionProps) {
  const t = useTranslations('creationCanvas.operate.people');
  const fmt = useFormat();
  const { status, summary } = useSiteAudience(projectId);

  const body = (() => {
    if (status === 'loading') return <p className={styles.placeSectionHint} role="status">{t('loading')}</p>;
    if (status === 'error') return <p className={styles.placeSectionHint} role="alert">{t('error')}</p>;
    if (status === 'idle' || !summary?.published) {
      return <p className={styles.placeSectionHint} role="status">{t('notPublished')}</p>;
    }
    const stats: Array<{ id: string; value: string; label: string }> = [
      { id: 'users', value: fmt.number(summary.users), label: t('users') },
      { id: 'new-users', value: fmt.number(summary.newUsers), label: t('newUsers', { days: summary.days }) },
      { id: 'visitors', value: t('approximate', { value: fmt.number(summary.visitors) }), label: t('visitors') },
      { id: 'page-views', value: fmt.number(summary.pageViews), label: t('pageViews') },
      { id: 'leads', value: fmt.number(summary.leads), label: t('leads') },
    ];
    return <>
      <ul className={styles.placeStats} data-testid="operate-people-stats">
        {stats.map((stat) => <li key={stat.id} data-testid={`operate-people-${stat.id}`}><strong>{stat.value}</strong><span>{stat.label}</span></li>)}
      </ul>
      <p className={styles.placeSectionHint}>{t('trafficNote', { days: summary.days })}</p>
    </>;
  })();

  return (
    <section className={styles.placeSection} aria-labelledby="operate-people" data-testid="operate-people">
      <div className={styles.placeSectionHead}><h2 id="operate-people" className={styles.placeSectionTitle}>{t('title')}</h2></div>
      {body}
    </section>
  );
}
