// No 'use client' directive: rendered only inside `CreationCanvas`, which declares it.
import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { isPublishableObjectKind } from '@builderforce/creation-canvas-contract';
import { SellInMarketplace } from './SellInMarketplace';
import { useCanvasSessionFacts } from './chrome/canvasSessionContext';
import type { CanvasSessionActionHandler } from './CanvasSessionActions';
import type { CreationFlowNode } from './CreationNode';
import styles from './CreationCanvas.module.css';

/**
 * The doors a board-scoped PLACE opens — every one of them a door the canvas already has.
 * Built by the host once and handed to `CanvasSurfaceStage`, the same way every other
 * surface receives the host callbacks it needs; never new host state.
 */
export interface CanvasPlaceDoors {
  /** The Make-it-real "Prove it" row (`/realize` for this session). */
  prove: CanvasSessionActionHandler;
  /** The bar's Publish — the release lifecycle, or the App surface's own publish. */
  publish: CanvasSessionActionHandler;
  /** `CanvasPublishPanel` — list in the marketplace; an object id preselects it. */
  openListing: (objectId?: string) => void;
  /** `CanvasReleasesPanel` — Build → Stage → Live; an object id scopes it. */
  openReleases: (objectId?: string) => void;
  /** `CanvasSocialPanel`, behind the connected-account gate the ••• row uses. */
  openSocial: () => void;
}

export interface CanvasLaunchSurfaceProps {
  nodes: readonly CreationFlowNode[];
  doors: CanvasPlaceDoors;
  onExit: () => void;
}

const TELL_KINDS = ['socialPost', 'socialCampaign', 'emailCampaign'] as const;

/**
 * LAUNCH — the Make-it-real door laid out as a place (offered at Reach).
 *
 * The door on the bar is a menu you pass through; a session in Reach WORKS here. Four
 * sections, in the order the arc asks them, each composing what already exists:
 *   1. Prove it   — the realization verdict the door's "Prove it" row opens.
 *   2. Publish    — the release lifecycle and the marketplace listing
 *                   (`CanvasReleasesPanel`, `CanvasPublishPanel`).
 *   3. Sell       — `SellInMarketplace` for the first sellable object on the board.
 *   4. Tell people — the board's posts and campaigns, and `CanvasSocialPanel`.
 *
 * The door stays: every row of `CanvasMakeItReal` keeps working, so nothing moved.
 */
export function CanvasLaunchSurface({ nodes, doors, onExit }: CanvasLaunchSurfaceProps) {
  const t = useTranslations('creationCanvas.launch');
  const { canEdit } = useCanvasSessionFacts();
  const sellable = useMemo(() => nodes.find((node) => isPublishableObjectKind(node.data.kind)) ?? null, [nodes]);
  const told = useMemo(() => TELL_KINDS.map((kind) => ({ kind, count: nodes.filter((node) => node.data.kind === kind).length })), [nodes]);
  const toldTotal = told.reduce((sum, entry) => sum + entry.count, 0);
  const proveAvailable = doors.prove.available !== false;

  return (
    <section
      className={styles.placeSurface}
      data-testid="canvas-launch-surface"
      aria-label={t('regionLabel')}
      onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onExit(); } }}
    >
      <div className={styles.placeSurfaceBody}>
        <section className={styles.placeSection} aria-labelledby="launch-prove" data-testid="launch-prove">
          <div className={styles.placeSectionHead}>
            <h2 id="launch-prove" className={styles.placeSectionTitle}>{t('prove')}</h2>
            {proveAvailable && <button type="button" className={styles.phasePathButton} data-primary="true" disabled={doors.prove.disabled} onClick={doors.prove.run}>{t('proveAction')}</button>}
          </div>
          <p className={styles.placeSectionHint}>{proveAvailable ? t('proveHint') : t('proveNeedsAccount')}</p>
        </section>

        <section className={styles.placeSection} aria-labelledby="launch-publish" data-testid="launch-publish">
          <div className={styles.placeSectionHead}>
            <h2 id="launch-publish" className={styles.placeSectionTitle}>{t('publish')}</h2>
            <div className={styles.phasePathActions}>
              <button type="button" className={styles.phasePathButton} disabled={doors.publish.disabled} onClick={doors.publish.run}>{t('publishAction')}</button>
              <button type="button" className={styles.phasePathButton} disabled={!canEdit} onClick={() => doors.openListing()}>{t('listAction')}</button>
            </div>
          </div>
          <p className={styles.placeSectionHint}>{t('publishHint')}</p>
        </section>

        <section className={styles.placeSection} aria-labelledby="launch-sell" data-testid="launch-sell">
          <div className={styles.placeSectionHead}><h2 id="launch-sell" className={styles.placeSectionTitle}>{t('sell')}</h2></div>
          {sellable
            ? <SellInMarketplace
              kind={sellable.data.kind}
              disabled={!canEdit}
              onPublish={() => doors.openListing(sellable.id)}
              onReleases={() => doors.openReleases(sellable.id)}
            />
            : <p className={styles.placeSectionHint} role="status">{t('nothingToSell')}</p>}
        </section>

        <section className={styles.placeSection} aria-labelledby="launch-tell" data-testid="launch-tell">
          <div className={styles.placeSectionHead}>
            <h2 id="launch-tell" className={styles.placeSectionTitle}>{t('tell')}</h2>
            <button type="button" className={styles.phasePathButton} onClick={doors.openSocial}>{t('tellAction')}</button>
          </div>
          {toldTotal
            ? <ul className={styles.placeList}>
              {told.filter((entry) => entry.count > 0).map((entry) => <li key={entry.kind}><span>{t(`told.${entry.kind}`)}</span><small>{entry.count}</small></li>)}
            </ul>
            : <p className={styles.placeSectionHint} role="status">{t('nothingTold')}</p>}
        </section>
      </div>
    </section>
  );
}
