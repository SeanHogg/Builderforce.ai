/**
 * "Erase this visitor" (PRD 33 §1.7, D17): a manager actions a privacy request for
 * the visitor behind a recording — every kept recording of that visitor on THIS
 * site goes (rows, AI summaries, bytes). Destructive, so it asks first
 * (`useConfirm`); gated, never hidden (`RoleGate`, MANAGER). The API scopes the
 * erase to the workspace's own site and traces it (`replay.visitor.erased`).
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { replayApi } from '@/lib/replayApi';
import { useErrorText } from '@/i18n/useErrorMessage';
import { useConfirm } from '@/components/ConfirmProvider';
import { RoleGate } from '@/components/RoleGate';

export function EraseVisitorAction({ siteId, visitorId, onErased }: { siteId: string; visitorId: string; onErased?: () => void }) {
  const t = useTranslations('insights.eraseVisitor');
  const errorText = useErrorText();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; tone: 'status' | 'alert' } | null>(null);

  const erase = async () => {
    const ok = await confirm({ title: t('confirmTitle'), message: t('confirmMessage'), confirmLabel: t('confirm'), destructive: true });
    if (!ok) return;
    setBusy(true);
    setNote(null);
    try {
      const result = await replayApi.eraseVisitor(siteId, visitorId);
      setNote({ text: t('done', { count: result.erased }), tone: 'status' });
      onErased?.();
    } catch (failure) {
      setNote({ text: errorText(failure), tone: 'alert' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-2)' }}>
      <RoleGate capability="insights.manageSites">
        <button
          type="button"
          className="btn-secondary"
          style={{ minHeight: 44, color: 'var(--error)' }}
          disabled={busy}
          aria-busy={busy}
          onClick={() => void erase()}
        >
          {busy ? t('erasing') : t('action')}
        </button>
      </RoleGate>
      {note && (
        <p role={note.tone} style={{ margin: 0, fontSize: 'var(--font-size-small)', color: note.tone === 'alert' ? 'var(--error)' : 'var(--text-secondary)' }}>
          {note.text}
        </p>
      )}
    </div>
  );
}
