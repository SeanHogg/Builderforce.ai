/**
 * WHAT YOU OWN — the app panel a converted project never had.
 *
 * ── THE GAP ──────────────────────────────────────────────────────────────────
 * Conversion writes a project, claims an address, reserves a site and links the
 * board to it. Then the project showed NONE of it: no address, no runtime, no
 * data, no people. A creator who had just turned an idea into a running thing
 * had no page that said so.
 *
 * ── WHY STATEMENTS AND NOT SETTINGS ──────────────────────────────────────────
 * Operator decision 3: there is NO choice of host and NO choice of database.
 * Apps run on Builderforce and their data lives here. So this panel REPORTS —
 * "it answers here", "it serves this build", "it holds these records", "this
 * many people came" — and offers no picker, because a picker would imply a
 * decision that does not exist. If something in here ever looks like a dropdown,
 * it is the wrong shape.
 *
 * ── WHY IT MOUNTS ITSELF ─────────────────────────────────────────────────────
 * It takes a `projectId` and nothing else, and renders `null` for a project with
 * no site — which is every project that was never converted and never published.
 * The host does not have to know that precondition, and cannot get it wrong.
 *
 * ── WHY IT DOES NOT RE-IMPLEMENT THE GROWTH PANELS ───────────────────────────
 * `components/site/SiteGrowthPanels.tsx` already owns the WRITE surfaces for a
 * published site (claim a domain, create a collection, read submissions). This
 * reads the same endpoints through the same typed clients and states the
 * result — one bounded context, two altitudes, no second copy of the transport.
 */

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { formatBytes } from '@/lib/canvasDocuments';
import {
  appAddresses,
  appDataFacts,
  appIsPublished,
  appPeopleFacts,
  embeddedAppsApi,
  type AppOverview,
} from '@/lib/embeddedApps';
import { AppAddress, AppCounts, AppStatement } from './AppStatement';
import styles from './appPanels.module.css';

export interface ProjectAppPanelProps {
  projectId: number | string;
}

export function ProjectAppPanel({ projectId }: ProjectAppPanelProps) {
  const t = useTranslations('canvas.app');
  const [overview, setOverview] = useState<AppOverview | null>(null);

  useEffect(() => {
    let live = true;
    embeddedAppsApi.overview(projectId)
      .then((next) => { if (live) setOverview(next); })
      .catch(() => { if (live) setOverview(null); });
    return () => { live = false; };
  }, [projectId]);

  // No site means this project is not an app. Nothing to report, so nothing is
  // rendered — the precondition lives here rather than in whatever mounts it.
  if (!overview?.site) return null;

  const site = overview.site;
  const { primary, custom } = appAddresses(overview);
  const published = appIsPublished(overview);
  const data = appDataFacts(overview);
  const people = appPeopleFacts(overview);
  // `total_bytes` crosses the wire as a string (int8 would lose precision as a
  // number), so it is coerced at the edge rather than trusted to be numeric.
  const bytes = Number(site.totalBytes) || 0;

  return (
    <div className={styles.panel}>
      <AppStatement
        title={t('sectionAddress')}
        statement={primary ? t('addressIs') : t('addressPending')}
        detail={custom ? t('addressAlsoCustom') : undefined}
        badge={published
          ? { label: t('badgeLive'), tone: 'ok' }
          : { label: t('badgeReserved'), tone: 'pending' }}
      >
        <AppAddress url={primary} fallback={site.subdomain} />
        {custom && <AppAddress url={custom} />}
        {!published && <p className={styles.hint}>{t('addressHeldHint')}</p>}
      </AppStatement>

      <AppStatement
        title={t('sectionRuntime')}
        statement={t('runtimeStatement')}
        detail={t('runtimeNoChoice')}
      >
        <p className={styles.statementDetail}>
          {published
            ? t('runtimeServing', { version: site.versionToken, size: formatBytes(bytes) })
            : t('runtimeNothingServed')}
        </p>
      </AppStatement>

      <AppStatement
        title={t('sectionData')}
        statement={t('dataStatement')}
        detail={t('dataNoChoice')}
        badge={data.gated > 0 ? { label: t('badgeSignIn'), tone: 'ok' } : undefined}
      >
        {data.collections === 0 ? (
          <p className={styles.hint}>{t('dataEmpty')}</p>
        ) : (
          <>
            <AppCounts
              items={[
                { label: t('countCollections'), value: data.collections },
                { label: t('countRecords'), value: data.records },
              ]}
            />
            <ul className={styles.rows}>
              {overview.collections.map((collection) => (
                <li key={collection.id} className={styles.row}>
                  <span className={styles.rowName}>{collection.name}</span>
                  <span>
                    {t('collectionRecords', { count: collection.recordCount })}
                    {collection.audienceId !== null ? ` · ${t('collectionGated')}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </AppStatement>

      <AppStatement
        title={t('sectionPeople')}
        statement={people.visitors > 0 ? t('peopleStatement') : t('peopleNobodyYet')}
        detail={people.approximate ? t('peopleApproximate') : undefined}
      >
        {people.visitors > 0 && (
          <AppCounts
            items={[
              { label: t('countVisitors'), value: people.visitors },
              { label: t('countViews'), value: people.pageViews },
            ]}
          />
        )}
      </AppStatement>
    </div>
  );
}
