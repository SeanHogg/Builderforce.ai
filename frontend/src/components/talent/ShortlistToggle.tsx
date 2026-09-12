'use client';

/**
 * "Shortlist this person" on a profile.
 *
 * Available to any signed-in workspace member — including one who is nowhere near ready
 * to hire, which is the entire point of a shortlist. Deliberately NOT gated behind a
 * role: `POST /api/marketplace/saved-talent` carries `authMiddleware` and no
 * `requireRole`, and a control disabled here that the server accepts is the mirror of the
 * bug `RoleGate` exists to prevent.
 */
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import { savedTalentIds, saveTalent, unsaveTalent } from '@/lib/freelance/invites';
import { usePanelTask } from '@/hooks/usePanelTask';
export function ShortlistToggle({ freelancerUserId }: { freelancerUserId: string }) {
  const t = useTranslations('talent');
  const [saved, setSaved] = useState<boolean | null>(null);
  const task = usePanelTask();

  useEffect(() => {
    let cancelled = false;
    savedTalentIds([freelancerUserId])
      .then((saved) => {
        if (!cancelled) setSaved(saved.has(freelancerUserId));
      })
      // No workspace, no shortlist — and no error to show somebody who was only looking
      // at a profile. `null` keeps the control off the page entirely.
      .catch(() => { if (!cancelled) setSaved(null); });
    return () => { cancelled = true; };
  }, [freelancerUserId]);

  if (saved === null) return null;

  const toggle = async () => {
    const result = await task.run(async () => {
      if (saved) await unsaveTalent(freelancerUserId);
      else await saveTalent({ freelancerUserId });
      return true;
    }, { failure: t('shortlist.failed') });
    if (result === undefined) return;
    setSaved(!saved);
  };

  return (
    <button
      type="button"
      disabled={task.busy}
      aria-pressed={saved}
      title={task.error ?? undefined}
      onClick={() => void toggle()}
      style={{
        padding: '9px 16px', borderRadius: 'var(--radius-lg)', cursor: task.busy ? 'wait' : 'pointer',
        fontWeight: 600, fontSize: 'var(--font-size-small)',
        border: `1px solid ${saved ? 'var(--coral-bright)' : 'var(--border-subtle)'}`,
        background: saved ? 'var(--surface-coral-soft)' : 'var(--bg-elevated)',
        color: saved ? 'var(--coral-bright)' : 'var(--text-primary)',
      }}
    >
      <Icon name={saved ? 'check' : 'plus'} size={13} /> {saved ? t('shortlist.saved') : t('shortlist.save')}
    </button>
  );
}
