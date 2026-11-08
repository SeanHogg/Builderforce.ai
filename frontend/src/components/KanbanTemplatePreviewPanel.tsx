'use client';

import { useTranslations } from 'next-intl';
import { useMoneyFormat } from '@/lib/useMoneyFormat';
import type { KanbanTemplatePreview } from '@/lib/kanban';

/**
 * A priced template the workspace has not bought: name, description, price and lane names
 * only. "Unlock" re-enters the ordinary install path, whose 402 starts the listing checkout.
 */
export function KanbanTemplatePreviewPanel({ template, onUnlock, onClose }: {
  template: KanbanTemplatePreview;
  onUnlock: (id: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations('kanbanTemplateCheckout');
  const { formatCents } = useMoneyFormat();
  const lanes = [...template.lanes].sort((a, b) => a.position - b.position);
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)',
      padding: 16, display: 'flex', flexDirection: 'column', gap: 12,
    }}>
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>{template.name}</h2>
        {template.description && (
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '4px 0 0' }}>{template.description}</p>
        )}
      </div>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>{t('previewLockedNotice')}</p>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>{t('previewLanes')}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {lanes.map((l) => (
            <span key={l.key} style={{
              fontSize: 12, padding: '2px 10px', borderRadius: 'var(--radius-full)',
              background: 'var(--surface-2)', color: 'var(--text-primary)', border: '1px solid var(--border)',
            }}>{l.name}</span>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => onUnlock(template.id)} style={{
          fontSize: 12, padding: '5px 12px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontWeight: 600,
          background: 'var(--accent)', color: 'var(--text-on-accent)', border: 'none',
        }}>{t('previewUnlock', { price: formatCents(template.priceCents) })}</button>
        <button type="button" onClick={onClose} style={{
          fontSize: 12, padding: '5px 12px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontWeight: 600,
          background: 'var(--surface-2)', color: 'var(--text-primary)', border: '1px solid var(--border)',
        }}>{t('previewBack')}</button>
      </div>
    </div>
  );
}
