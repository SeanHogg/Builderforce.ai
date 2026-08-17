import { useTranslations } from 'next-intl';
import { openProductUpdates } from '@/lib/productUpdates';
import { useProductUpdatesUnread } from '@/lib/betaPrograms';
import styles from './ProductUpdatesTrigger.module.css';

/**
 * The version chip that opens the Product Updates panel — ONE component, both
 * places it appears (the marketing/auth footer strip and the operator shell's
 * `LegalStrip`, shared by the sidebar and the docked Brain panel).
 *
 * It was two hand-written buttons rendering the same string, with the same
 * handler and the same tooltip, which is two places for the unread badge to be
 * added to one of. The chip now owns all of it, including whether the badge
 * shows at all: an unread count of zero — a signed-out visitor, or someone who
 * has just read the changelog — renders no badge, so no host has to ask.
 *
 * `className` is the host's own link class, because the two strips are styled by
 * their own stylesheets; everything the chip is ABOUT belongs to the chip.
 *
 * No `'use client'`, deliberately: its only two importers — `AppFooter` and
 * `LegalStrip` — already declare the boundary, so the directive would buy them
 * nothing and cost the architecture ratchet a point. It runs as client code
 * either way, which is what its hooks need.
 */
export default function ProductUpdatesTrigger({
  appVersion,
  apiVersion,
  className,
}: {
  appVersion: string;
  apiVersion: string | null;
  className: string;
}) {
  const t = useTranslations('footer');
  const unread = useProductUpdatesUnread();

  return (
    <button
      type="button"
      onClick={openProductUpdates}
      className={`${className} ${styles.trigger}`}
      title={unread > 0 ? t('whatsNewUnread', { count: unread }) : t('whatsNewHint')}
    >
      UI {appVersion} · API {apiVersion ?? '…'}
      {unread > 0 && (
        // The number is capped for LAYOUT, not for truth: a two-digit badge in a
        // version strip pushes the legal links onto a second row at narrow
        // widths, and "9+" answers the only question the badge is asked.
        <span className={styles.badge} aria-label={t('whatsNewUnread', { count: unread })}>
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </button>
  );
}
