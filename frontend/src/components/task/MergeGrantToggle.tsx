import { useTranslations } from 'next-intl';
import { useId } from 'react';
import { usePermission } from '@/lib/rbac';

/**
 * "Merge into main when done" — a person's merge grant for ONE run (PRD 48 §4.6).
 *
 * The grant is a pre-approved version of the in-product Merge button: when the run's pull
 * request passes its security scan and CI, the platform merges it into main, whatever the
 * project's merge settings say. So it needs the same role (`runtime.mergeGrant`), and a reason
 * — the audit question is "who let this into main, and why".
 *
 * DISABLED, never hidden, for a role that cannot grant (the RBAC convention), with the role
 * the control needs as its tooltip. Theme tokens only; wraps at 360px.
 */
export interface MergeGrantValue {
  enabled: boolean;
  reason: string;
}

export function MergeGrantToggle({ value, onChange, disabled, cloudTarget = true }: {
  value: MergeGrantValue;
  onChange: (next: MergeGrantValue) => void;
  disabled?: boolean;
  /** A grant applies to a CLOUD run only — disabled (with why) for an on-prem host or "auto". */
  cloudTarget?: boolean;
}) {
  const t = useTranslations('mergeGrant');
  const tCommon = useTranslations('common');
  const { allowed, required } = usePermission('runtime.mergeGrant');
  const available = allowed && cloudTarget;
  const locked = !available || disabled;
  const reasonId = useId();
  const missingReason = available && value.enabled && value.reason.trim() === '';
  const tooltip = !allowed ? tCommon('requiresRoleHint', { role: required }) : !cloudTarget ? t('cloudOnly') : t('help');

  return (
    <div style={{ marginTop: 8, display: 'grid', gap: 6, minWidth: 0 }}>
      <label
        title={tooltip}
        style={{
          display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: 'var(--text-primary)',
          cursor: locked ? 'not-allowed' : 'pointer', opacity: available ? 1 : 0.6, flexWrap: 'wrap',
        }}
      >
        <input
          type="checkbox"
          checked={available && value.enabled}
          disabled={locked}
          aria-disabled={locked}
          onChange={(e) => onChange({ ...value, enabled: e.target.checked })}
          style={{ marginTop: 2, accentColor: 'var(--accent)' }}
        />
        <span style={{ display: 'grid', gap: 2, minWidth: 0, flex: '1 1 200px' }}>
          <span style={{ fontWeight: 600 }}>{t('label')}</span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('help')}</span>
        </span>
      </label>
      {value.enabled && available && (
        <div style={{ display: 'grid', gap: 4, minWidth: 0 }}>
          <label htmlFor={reasonId} style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
            {t('reasonLabel')}
          </label>
          <textarea
            id={reasonId}
            value={value.reason}
            required
            rows={2}
            maxLength={2000}
            disabled={disabled}
            placeholder={t('reasonPlaceholder')}
            aria-invalid={missingReason}
            onChange={(e) => onChange({ ...value, reason: e.target.value })}
            style={{
              width: '100%', boxSizing: 'border-box', padding: '7px 10px', fontSize: 13, resize: 'vertical',
              border: `1px solid ${missingReason ? 'var(--danger)' : 'var(--border-subtle)'}`,
              borderRadius: 'var(--radius-md)', background: 'var(--bg-deep)', color: 'var(--text-primary)',
            }}
          />
          {missingReason && <span style={{ fontSize: 12, color: 'var(--danger)' }}>{t('reasonRequired')}</span>}
        </div>
      )}
    </div>
  );
}

/** The grant to send with a run, or undefined when there is none (or it is incomplete). */
export function mergeGrantOf(value: MergeGrantValue): { reason: string } | undefined {
  const reason = value.reason.trim();
  return value.enabled && reason ? { reason } : undefined;
}
