'use client';

/**
 * The invitations standing on ONE posting — the employer's side of the row.
 *
 * An invite is a state machine, so this shows its STATE rather than "sent ✓". `expired` is
 * projected by the server from the deadline and the clock (there is no expiry sweep — a
 * cron that rewrites rows to say what the clock already says is a second source of truth
 * that can lag), so what is rendered here is always what the response path would accept.
 *
 * Withdrawal is offered only for UNANSWERED invites. Deleting somebody's "no" would be
 * rewriting the record of the exchange, and the API refuses it either way.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useFormat } from '@/i18n/useFormat';
import { inviteStatusKey } from './jobVocabulary';
import { listJobInvites, withdrawJobInvite, type JobInvite } from '@/lib/freelance/invites';

const card: React.CSSProperties = {
  background: 'var(--bg-base)', border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)', padding: 14, minWidth: 0,
};

const STATUS_TONE: Record<string, { bg: string; fg: string }> = {
  sent: { bg: 'rgba(59,130,246,0.12)', fg: 'rgba(59,130,246,0.95)' },
  viewed: { bg: 'rgba(59,130,246,0.12)', fg: 'rgba(59,130,246,0.95)' },
  accepted: { bg: 'rgba(34,197,94,0.14)', fg: 'rgba(34,197,94,0.95)' },
  declined: { bg: 'var(--bg-elevated)', fg: 'var(--text-muted)' },
  expired: { bg: 'var(--bg-elevated)', fg: 'var(--text-muted)' },
};

export function JobInvitesPanel({ jobId }: { jobId: string }) {
  const t = useTranslations('talent');
  const fmt = useFormat();
  const [invites, setInvites] = useState<JobInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try { setInvites(await listJobInvites(jobId)); }
    catch (e) { setError(e instanceof Error ? e.message : t('invite.loadError')); }
    finally { setLoading(false); }
  }, [jobId, t]);

  useEffect(() => { void load(); }, [load]);

  const withdraw = async (invite: JobInvite) => {
    setBusy(invite.id);
    setError(null);
    try { await withdrawJobInvite(jobId, invite.id); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : t('invite.failed')); }
    finally { setBusy(null); }
  };

  if (loading) return <p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-small)' }}>{t('invite.loading')}</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      <h3 style={{ margin: 0, fontSize: 'var(--font-size-card-title)', fontWeight: 700, color: 'var(--text-primary)' }}>
        {t('invite.heading')}
      </h3>
      {error && <div style={{ ...card, color: 'var(--coral-bright)', fontSize: 'var(--font-size-small)' }}>{error}</div>}
      {invites.length === 0 ? (
        <div style={{ ...card, color: 'var(--text-muted)', fontSize: 'var(--font-size-small)' }}>{t('invite.emptyForJob')}</div>
      ) : (
        invites.map((invite) => {
          const tone = STATUS_TONE[invite.status] ?? STATUS_TONE.declined!;
          return (
            <div key={invite.id} style={{ ...card, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <Link
                href={`/talent/${invite.freelancerUserId}`}
                style={{ fontSize: 'var(--font-size-small)', fontWeight: 700, color: 'var(--text-primary)', textDecoration: 'none', minWidth: 0, overflowWrap: 'anywhere' }}
              >
                {invite.freelancerName ?? t('match.unnamed')}
              </Link>
              <span style={{ fontSize: 'var(--font-size-eyebrow)', fontWeight: 700, padding: '3px 9px', borderRadius: 'var(--radius-sm)', background: tone.bg, color: tone.fg }}>
                {t(inviteStatusKey(invite.status))}
              </span>
              {invite.expiresAt && (invite.status === 'sent' || invite.status === 'viewed') && (
                <span style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)' }}>
                  {t('invite.expires', { date: fmt.date(invite.expiresAt) })}
                </span>
              )}
              {/* The proposal an acceptance opened — the link that makes this a step in the
                  bid flow rather than a message somebody read. */}
              {invite.status === 'accepted' && invite.proposalId && (
                <span style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)' }}>{t('invite.openedProposal')}</span>
              )}
              {(invite.status === 'sent' || invite.status === 'viewed') && (
                <button
                  type="button"
                  disabled={busy === invite.id}
                  onClick={() => void withdraw(invite)}
                  style={{
                    marginLeft: 'auto', padding: '5px 12px', borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)',
                    color: 'var(--text-muted)', fontSize: 'var(--font-size-small)', fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  {t('invite.withdraw')}
                </button>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
