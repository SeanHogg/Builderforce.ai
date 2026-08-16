/**
 * "Sell this in the marketplace" — the one entry point into the release lifecycle,
 * wherever a canvas object is being looked at.
 *
 * It DECIDES ITS OWN VISIBILITY from the listing registry rather than taking a
 * `canPublish` prop: whether a `game` is sellable and a `comment` is not is a fact
 * about the kind, known to `@builderforce/creation-canvas-contract`, and every call
 * site that re-derived it would be a place the answer could drift from the server's.
 * A kind with no listing spec renders nothing at all.
 *
 * ── WHY TWO BUTTONS AND NOT ONE ──────────────────────────────────────────────────
 * They answer two different questions. "What is this and what does it cost" is a
 * form. "Which version is on sale, is the next one fit to sell, and can I go back to
 * the one that worked" is a lifecycle, and it is the half that did not exist — the
 * snapshots were always written and nothing ever read them.
 *
 * The harness is named here, before either is pressed, because it is what a seller
 * most wants to know in advance: not "will this publish" but "what will be CHECKED".
 * Read from the same shared derivation the server gates on, so the promise on this
 * button and the gate behind it cannot disagree.
 *
 * ── WHY IT RESOLVES A DELIVERY IT DOES NOT LET YOU CHOOSE ────────────────────────
 * The harness follows the delivery: the same `website` is a captured document when
 * you sell the BUILD and a live address when you sell ACCESS. This is a hint in an
 * inspector, not the place that decides — the seller chooses in the release panel,
 * against a staged candidate. So it resolves the delivery the SERVER would choose if
 * they changed nothing (`resolveDelivery(kind, null)`) and names it, which makes the
 * sentence true for the default path and says which default it is. Offering the
 * choice here as well would be a third place holding one answer, and the third place
 * is always the one that goes stale.
 *
 * Deliberately buttons and not forms. The inspector already holds forty controls.
 */

import { useTranslations } from 'next-intl';
import {
  deliveriesForKind,
  isPublishableObjectKind,
  listingKindsForObjectKind,
  resolveDelivery,
  resolveListingHarness,
} from '@builderforce/creation-canvas-contract';
import styles from './CreationCanvas.module.css';

export function SellInMarketplace({
  kind,
  disabled,
  onPublish,
  onReleases,
}: {
  kind: string;
  /** True when the session role (or an editing lock) forbids changes. */
  disabled?: boolean;
  onPublish: () => void;
  /** Opens Build → Stage → Live for this card. */
  onReleases: () => void;
}) {
  const t = useTranslations('creationCanvas.publish');
  const tr = useTranslations('creationCanvas.releases');
  const ts = useTranslations('commerce.stage');
  if (!isPublishableObjectKind(kind)) return null;
  const first = listingKindsForObjectKind(kind)[0];
  // The delivery the server would pick if the seller changed nothing — one
  // derivation, so this hint and the harness that actually runs agree.
  const delivery = first ? resolveDelivery(first.id, null) : null;
  const harness = first && delivery ? resolveListingHarness(first.id, kind, delivery) : null;
  // Said out loud only when there is another door to choose. For the thirteen kinds
  // that hand over the thing itself there is no decision, and naming it would be
  // noise on every card on the board.
  const choosable = first ? deliveriesForKind(first.id).length > 1 : false;

  return (
    <section
      aria-label={t('sectionLabel')}
      style={{ display: 'grid', gap: 6, paddingTop: 12, borderTop: '1px solid var(--border-subtle)' }}
    >
      <strong style={{ fontSize: 'var(--font-size-eyebrow)' }}>{t('sectionLabel')}</strong>
      <button type="button" className={styles.fullButton} disabled={disabled} onClick={onPublish}>
        {first ? t('sellAsAction', { kind: t(`kind.${first.id}`) }) : t('sellAction')}
      </button>
      <button type="button" className={styles.secondaryFullButton} onClick={onReleases}>
        {tr('openAction')}
      </button>
      <small className={styles.inspectorHint}>
        {harness ? tr('harnessLine', { harness: tr(`harness.${harness}`) }) : t('sellHint')}
      </small>
      {choosable && delivery && (
        <small className={styles.inspectorHint}>
          {ts('deliveryDefaultHint', { delivery: ts(`delivery.${delivery}`) })}
        </small>
      )}
    </section>
  );
}
