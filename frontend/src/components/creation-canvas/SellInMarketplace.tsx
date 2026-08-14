/**
 * "Sell this in the marketplace" — the one entry point into publishing, wherever
 * a canvas object is being looked at.
 *
 * It DECIDES ITS OWN VISIBILITY from the listing registry rather than taking a
 * `canPublish` prop: whether a `game` is sellable and a `comment` is not is a fact
 * about the kind, known to `@builderforce/creation-canvas-contract`, and every call
 * site that re-derived it would be a place the answer could drift from the server's.
 * A kind with no listing spec renders nothing at all.
 *
 * Deliberately a button and not a form. What the thing IS, what it costs and what a
 * stranger may do with it is a flow with its own state, and the inspector already
 * holds forty controls.
 */

import { useTranslations } from 'next-intl';
import { isPublishableObjectKind, listingKindsForObjectKind } from '@builderforce/creation-canvas-contract';
import styles from './CreationCanvas.module.css';

export function SellInMarketplace({
  kind,
  disabled,
  onPublish,
}: {
  kind: string;
  /** True when the session role (or an editing lock) forbids changes. */
  disabled?: boolean;
  onPublish: () => void;
}) {
  const t = useTranslations('creationCanvas.publish');
  if (!isPublishableObjectKind(kind)) return null;
  const first = listingKindsForObjectKind(kind)[0];

  return (
    <section
      aria-label={t('sectionLabel')}
      style={{ display: 'grid', gap: 6, paddingTop: 12, borderTop: '1px solid var(--border-subtle)' }}
    >
      <strong style={{ fontSize: 'var(--font-size-eyebrow)' }}>{t('sectionLabel')}</strong>
      <button type="button" className={styles.fullButton} disabled={disabled} onClick={onPublish}>
        {first ? t('sellAsAction', { kind: t(`kind.${first.id}`) }) : t('sellAction')}
      </button>
      <small className={styles.inspectorHint}>{t('sellHint')}</small>
    </section>
  );
}
