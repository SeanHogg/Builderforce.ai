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
 * Deliberately buttons and not forms. The inspector already holds forty controls.
 */

import { useTranslations } from 'next-intl';
import {
  isPublishableObjectKind,
  listingKindsForObjectKind,
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
  if (!isPublishableObjectKind(kind)) return null;
  const first = listingKindsForObjectKind(kind)[0];
  const harness = first ? resolveListingHarness(first.id, kind) : null;

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
    </section>
  );
}
