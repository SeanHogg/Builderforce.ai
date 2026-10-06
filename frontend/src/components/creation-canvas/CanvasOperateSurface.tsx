// No 'use client' directive: rendered only inside `CreationCanvas`, which declares it.
import { useTranslations } from 'next-intl';
import { DeploymentList } from './DeploymentList';
import { OperatePeopleSection } from './OperatePeopleSection';
import { useOperateReading } from './hooks/useOperateReading';
import { useCanvasPhase, useLetBrain } from './phase/CanvasPhaseContext';
import type { CreationFlowNode } from './CreationNode';
import styles from './CreationCanvas.module.css';

export interface CanvasOperateSurfaceProps {
  nodes: readonly CreationFlowNode[];
  /** Escape hands the board back, same as Insights — the rail is the way out. */
  onExit: () => void;
  onOpenApp: () => void;
  /** The release lifecycle (`CanvasReleasesPanel`) for the whole board. */
  onOpenReleases: () => void;
}

/**
 * OPERATE — what this session has RUNNING, as one place (offered from Run onward).
 *
 * Four sections, each a composition of something that already exists:
 *   1. Deployments — the board's `deployment` cards (`DeploymentList`, shared with the
 *      room's ops station). Not live yet → the one press that fixes it.
 *   2. People — who the published app reached (`OperatePeopleSection`): end users, new
 *      sign-ups, approximate visitors, page views and form leads, read from what the
 *      platform already records for the primary app's site (`site_users`,
 *      `site_traffic_daily`, `site_collections`) via `/site/audience-summary`. Keyed by
 *      the primary app's durable project; a local or unpublished app says how to get there.
 *   3. Releases — the board's release cards, and the door into the release lifecycle
 *      the bar's Publish already opens (`CanvasReleasesPanel`).
 *   4. App — the session's primary app and the way into it.
 */
export function CanvasOperateSurface({ nodes, onExit, onOpenApp, onOpenReleases }: CanvasOperateSurfaceProps) {
  const t = useTranslations('creationCanvas.operate');
  const tc = useTranslations('creationCanvas');
  const tn = useTranslations('nav');
  const reading = useOperateReading(nodes);
  const letBrain = useLetBrain();
  const setPhase = useCanvasPhase()?.setPhase;

  return (
    <section
      className={styles.placeSurface}
      data-testid="canvas-operate-surface"
      aria-label={t('regionLabel')}
      onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onExit(); } }}
    >
      <div className={styles.placeSurfaceBody}>
        <section className={styles.placeSection} aria-labelledby="operate-deployments" data-testid="operate-deployments">
          <div className={styles.placeSectionHead}><h2 id="operate-deployments" className={styles.placeSectionTitle}>{t('deployments')}</h2></div>
          {reading.deployments.length > 0 && <DeploymentList deployments={reading.deployments} />}
          {!reading.live && (reading.hasApp
            ? <>
              <p className={styles.placeSectionHint} role="status">{t('notLive')}</p>
              {letBrain && <div className={styles.phasePathActions}>
                <button type="button" className={styles.phasePathButton} data-primary="true" onClick={() => letBrain.runRequirement('live')}>
                  {letBrain.requirementLabel('live')}
                </button>
              </div>}
            </>
            : <>
              <p className={styles.placeSectionHint} role="status">{t('noApp')}</p>
              <div className={styles.phasePathActions}>
                {setPhase && <button type="button" className={styles.phasePathButton} onClick={() => setPhase('make')}>
                  {tc('phasePath.goTo', { phase: tn('stage.make') })}
                </button>}
                {letBrain && <button type="button" className={styles.phasePathButton} data-primary="true" onClick={() => letBrain.runRequirement('app')}>
                  {letBrain.requirementLabel('app')}
                </button>}
              </div>
            </>)}
        </section>

        <OperatePeopleSection projectId={reading.app?.projectId ?? null} />

        <section className={styles.placeSection} aria-labelledby="operate-releases" data-testid="operate-releases">
          <div className={styles.placeSectionHead}>
            <h2 id="operate-releases" className={styles.placeSectionTitle}>{t('releases')}</h2>
            <button type="button" className={styles.phasePathButton} onClick={onOpenReleases}>{t('openReleases')}</button>
          </div>
          {reading.releases.length
            ? <ul className={styles.placeList}>
              {reading.releases.map((release) => <li key={release.id}><span>{release.title || t('untitledRelease')}</span>{release.status && <small>{release.status}</small>}</li>)}
            </ul>
            : <p className={styles.placeSectionHint}>{t('noReleases')}</p>}
        </section>

        <section className={styles.placeSection} aria-labelledby="operate-app" data-testid="operate-app">
          <div className={styles.placeSectionHead}>
            <h2 id="operate-app" className={styles.placeSectionTitle}>{t('app')}</h2>
            {reading.hasApp && <button type="button" className={styles.phasePathButton} onClick={onOpenApp}>{t('openApp')}</button>}
          </div>
          <p className={styles.placeSectionHint}>
            {reading.app ? t('appStatus', { title: reading.app.title, state: reading.live ? t('stateLive') : t('stateNotLive') }) : reading.hasApp ? t('appFromCode') : t('noAppShort')}
          </p>
        </section>
      </div>
    </section>
  );
}
