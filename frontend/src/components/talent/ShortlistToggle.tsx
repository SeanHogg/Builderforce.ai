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
import { listSavedTalent, saveTalent, unsaveTalent } from '@/lib/freelancerApi';

export function ShortlistToggle({ freelancerUserId }: { freelancerUserId: string }) {
  const t = useTranslations('talent');
  const [saved, setSaved] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listSavedTalent()
      .then((result) => {
        if (!cancelled) setSaved(result.items.some((row) => row.freelancerUserId === freelancerUserId));
      })
      // No workspace, no shortlist — and no error to show somebody who was only looking
      // at a profile. `null` keeps the control off the page entirely.
      .catch(() => { if (!cancelled) setSaved(null); });
    return () => { cancelled = true; };
  }, [freelancerUserId]);

  if (saved === null) return null;

  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      if (saved) { await unsaveTalent(freelancerUserId); setSaved(false); }
      else { await saveTalent({ freelancerUserId }); setSaved(true); }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('shortlist.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      disabled={busy}
      aria-pressed={saved}
      title={error ?? undefined}
      onClick={() => void toggle()}
      style={{
        padding: '9px 16px', borderRadius: 'var(--radius-lg)', cursor: busy ? 'wait' : 'pointer',
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
