// No `'use client'`: imported only by client components, so it is already on the client side of the boundary.

import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import type { CheckResult } from '@/lib/browserRuntime/projectChecks';

/**
 * Type-check / lint / build, from the status bar under the preview: the last
 * result, the button that runs them, and whether a failing result holds the
 * preview back. They used to be three controls in the header's second row,
 * competing with Publish for attention they are rarely due.
 */
export function ChecksControl({ results, checking, disabled, onCheck, gate, onGateChange }: {
  results: CheckResult[] | null;
  checking: boolean;
  disabled: boolean;
  onCheck: () => void;
  gate: boolean;
  onGateChange: (on: boolean) => void;
}) {
  const t = useTranslations('ide');
  const failed = results?.filter((r) => r.status === 'fail').length ?? 0;
  const passed = results?.filter((r) => r.status === 'pass').length ?? 0;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 8px', flexShrink: 0, fontSize: 'var(--font-size-small)' }}>
      {results && (
        <span
          title={results.map((r) => `${r.label}: ${r.status}${r.detail ? ` (${r.detail})` : ''}`).join('\n')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 600, whiteSpace: 'nowrap', color: failed > 0 ? 'var(--error-text)' : 'var(--success-text)' }}
        >
          <Icon name={failed > 0 ? 'close' : 'check'} size={14} />
          {failed > 0 ? t('checksFailed', { count: failed }) : t('checksPassed', { count: passed })}
        </span>
      )}
      <button
        type="button"
        onClick={onCheck}
        disabled={checking || disabled}
        title={t('runChecksHint')}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5, minHeight: 26, padding: '0 10px', whiteSpace: 'nowrap',
          borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', background: 'var(--bg-surface)',
          color: 'var(--text-secondary)', fontWeight: 600, cursor: checking || disabled ? 'wait' : 'pointer',
          opacity: checking || disabled ? 0.6 : 1,
        }}
      >
        {!checking && <Icon name="check" size={13} />}
        {checking ? t('checking') : t('check')}
      </button>
      <label title={t('blockOnFailHint')} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
        <input type="checkbox" checked={gate} onChange={(e) => onGateChange(e.target.checked)} style={{ cursor: 'pointer' }} />
        {t('gateRun')}
      </label>
    </div>
  );
}
