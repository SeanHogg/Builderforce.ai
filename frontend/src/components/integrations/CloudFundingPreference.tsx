import { useTranslations } from 'next-intl';
import { CLOUD_ORDERS } from '@builderforce/model-catalog';
import { useRovingRadioGroup } from '@seanhogg/builderforce-brain-ui';
import { useCloudFundingPreference } from './useCloudFundingPreference';

/**
 * "Which cloud runs my turns first" — free tier first, my connected accounts first, or
 * Automatic (inferred from whether any account is connected). Self-contained: it owns
 * its read and save, and renders nothing until the preference has loaded — or, when the
 * read fails, says so instead of showing the options with nothing selected.
 *
 * A real radio group for the keyboard — THE shared `useRovingRadioGroup` (the one the
 * inference-mode control uses): one tab stop, Arrow keys / Home / End move, Space /
 * Enter choose.
 */
export function CloudFundingPreference() {
  const t = useTranslations('integrations.cloudFunding');
  const { cloudOrder, choose, saving, loadFailed, saveFailed } = useCloudFundingPreference();
  const { itemProps } = useRovingRadioGroup(CLOUD_ORDERS.length, cloudOrder === null ? -1 : CLOUD_ORDERS.indexOf(cloudOrder));
  if (cloudOrder === null && !loadFailed) return null;
  const alertStyle = { color: 'var(--danger, var(--text-primary))', margin: '8px 0 0' } as const;

  return (
    <fieldset
      aria-busy={saving}
      style={{
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-md)',
        background: 'var(--bg-elevated)',
        padding: '14px 16px',
        margin: '0 0 16px',
        minWidth: 0,
      }}
    >
      <legend className="ui-text-card-title" style={{ fontWeight: 700, color: 'var(--text-primary)', padding: '0 4px' }}>{t('title')}</legend>
      <p className="ui-text-small" style={{ color: 'var(--text-muted)', margin: '0 0 12px' }}>{t('intro')}</p>
      {cloudOrder === null ? (
        <p role="alert" className="ui-text-small" style={alertStyle}>{t('loadFailed')}</p>
      ) : (
        <>
          <div role="radiogroup" aria-label={t('title')} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: 8 }}>
            {CLOUD_ORDERS.map((order, index) => {
              const selected = cloudOrder === order;
              return (
                <button
                  key={order}
                  {...itemProps(index)}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={saving}
                  onClick={() => { if (!selected) choose(order); }}
                  style={{
                    textAlign: 'left',
                    padding: '10px 12px',
                    minHeight: 44,
                    borderRadius: 'var(--radius-md)',
                    border: `1px solid ${selected ? 'var(--coral-bright)' : 'var(--border-subtle)'}`,
                    background: selected ? 'var(--bg-base)' : 'transparent',
                    color: 'var(--text-primary)',
                    cursor: saving ? 'progress' : 'pointer',
                  }}
                >
                  <span className="ui-text-body" style={{ display: 'block', fontWeight: 650 }}>{t(`option.${order}.label`)}</span>
                  <span className="ui-text-small" style={{ display: 'block', color: 'var(--text-secondary)', marginTop: 3 }}>{t(`option.${order}.description`)}</span>
                </button>
              );
            })}
          </div>
          <p className="ui-text-small" style={{ color: 'var(--text-muted)', margin: '10px 0 0' }}>{t('freeTwinNote')}</p>
          {saveFailed && <p role="alert" className="ui-text-small" style={alertStyle}>{t('saveFailed')}</p>}
        </>
      )}
    </fieldset>
  );
}
