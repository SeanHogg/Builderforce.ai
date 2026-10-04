import { memo } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

/**
 * Provider usage-cap banner — a BYO provider's key hit its billing limit this run.
 * The caller decides when it shows (it is keyed on the provider set).
 */
export const BrainProviderCapBanner = memo(function BrainProviderCapBanner({ providers, onDismiss }: {
  providers: readonly string[];
  onDismiss: () => void;
}) {
  const tBrain = useTranslations('brain');
  const tCommon = useTranslations('common');
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, margin: '8px 12px 0', padding: '8px 12px', fontSize: 'var(--font-size-small)', background: 'var(--warning-bg, rgba(234,179,8,0.12))', color: 'var(--warning-text)', border: '1px solid var(--warning-border, rgba(234,179,8,0.3))', borderRadius: 'var(--radius-md)' }} role="status">
      <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
        {tBrain('providerCapBanner', { providers: providers.join(', ') })}{' '}
        <Link href="/settings/integrations" style={{ color: 'inherit', fontWeight: 600, textDecoration: 'underline' }}>
          {tBrain('manageApiKeys')}
        </Link>
      </span>
      <button
        type="button"
        onClick={onDismiss}
        title={tCommon('dismiss')}
        aria-label={tCommon('dismiss')}
        style={{ flex: '0 0 auto', background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 'var(--font-size-card-title)', lineHeight: 1, padding: 0 }}
      >
        ×
      </button>
    </div>
  );
});
