import { memo } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';

/**
 * Human-in-the-loop confirm bar. Shown when the agent loop pauses on a mutating
 * tool call; Approve runs it, Cancel feeds a declined result back to the model.
 */
export const BrainToolConfirmBar = memo(function BrainToolConfirmBar({ req, onDecide, onApproveAll }: { req: { name: string; args: unknown }; onDecide: (ok: boolean) => void; onApproveAll: () => void }) {
  const tCommon = useTranslations('common');
  const tBrain = useTranslations('brain');
  const label = req.name.replace(/_/g, ' ');
  let preview = '';
  try {
    const s = JSON.stringify(req.args ?? {});
    preview = s.length > 240 ? `${s.slice(0, 240)}…` : s;
  } catch { preview = ''; }
  return (
    <div
      role="alertdialog"
      aria-label={tBrain('confirmActionAria')}
      style={{ marginBottom: 8, padding: '10px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--coral-bright)', background: 'var(--bg-elevated)' }}
    >
      <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-primary)', marginBottom: 6 }}>

        <Icon source="⚠️" size="1em" /> {tBrain.rich('wantsTo', { action: label, b: (chunks) => <strong>{chunks}</strong> })}
      </div>
      {preview && preview !== '{}' && (
        <div style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)', fontFamily: 'monospace', wordBreak: 'break-all', marginBottom: 8 }}>{preview}</div>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => onDecide(true)} style={{ padding: '6px 14px', fontSize: 'var(--font-size-small)', fontWeight: 600, background: 'var(--coral-bright)', color: 'var(--text-on-accent)', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}>{tCommon('approve')}</button>
        <button type="button" onClick={onApproveAll} title={tBrain('approveAllTitle')} style={{ padding: '6px 14px', fontSize: 'var(--font-size-small)', fontWeight: 600, background: 'var(--bg-base)', color: 'var(--coral-bright)', border: '1px solid var(--coral-bright)', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}>{tBrain('approveAll')}</button>
        <button type="button" onClick={() => onDecide(false)} style={{ padding: '6px 14px', fontSize: 'var(--font-size-small)', background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}>{tCommon('cancel')}</button>
      </div>
    </div>
  );
});
