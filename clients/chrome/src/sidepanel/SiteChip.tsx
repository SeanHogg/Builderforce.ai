/**
 * WHERE Rovr acts — the shared `ContextChip` in the composer's tool row, naming the site
 * of the tab Rovr is working in. It follows the tab as the person (or a tool) moves.
 * There is nothing to choose — Rovr acts on the tab it is working in — so the chip is
 * the shared chip's read-only form.
 */
import { ContextChip } from '@seanhogg/builderforce-brain-ui';
import { t } from '../i18n/t';
import { useWorkingSite } from './hooks';

export function SiteChip() {
  const site = useWorkingSite();
  return (
    <ContextChip
      className="rovr-site"
      label={t('contextLabel')}
      value={site ?? t('contextNoPage')}
      icon={(
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" />
        </svg>
      )}
    />
  );
}
