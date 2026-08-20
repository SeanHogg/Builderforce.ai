'use client';

/**
 * "Who should I invite to bid on this?" — the client side of the cached match query.
 *
 * ── WHY THE THREE ACTIONS SIT TOGETHER ──────────────────────────────────────────
 * Seeing a good candidate, shortlisting them and inviting them are one thought. Splitting
 * them across three surfaces is what turns a recommendation into a list nobody acts on:
 * the client reads a ranked page, opens a profile in another tab, loses the ranking, and
 * comes back to start again. So the card carries the score, the evidence, the shortlist
 * toggle and the invite — and the invite writes a ROW, not a notification, so the person
 * who accepts lands in the bid form (see `jobInvites.ts`).
 *
 * People who have already bid are absent by construction: the API excludes them, because
 * inviting somebody whose proposal is sitting in the next tab is the feature embarrassing
 * itself.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import { useMoneyFormat } from '@/lib/useMoneyFormat';
import { MatchScore, MatchSkills } from './MatchScore';
import {
  inviteToJob, listJobRecommendations, listSavedTalent, saveTalent, unsaveTalent,
  type TalentMatch,
} from '@/lib/freelancerApi';

const card: React.CSSProperties = {
  background: 'var(--bg-base)', border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)', padding: 14, minWidth: 0,
};

const ghostButton: React.CSSProperties = {
  padding: '6px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)',
  background: 'var(--bg-elevated)', color: 'var(--text-primary)',
  fontSize: 'var(--font-size-small)', fontWeight: 600, cursor: 'pointer',
};

const primaryButton: React.CSSProperties = {
  padding: '6px 14px', borderRadius: 'var(--radius-md)', border: 'none',
  background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
  color: 'var(--text-on-accent)', fontSize: 'var(--font-size-small)', fontWeight: 700, cursor: 'pointer',
};

export function TalentRecommendations({ jobId }: { jobId: string }) {
  const t = useTranslations('talent');
  const { formatCents } = useMoneyFormat();
  const [matches, setMatches] = useState<TalentMatch[]>([]);
  const [shortlisted, setShortlisted] = useState<Set<string>>(new Set());
  const [invitedNow, setInvitedNow] = useState<Set<string>>(new Set());
  const [messageFor, setMessageFor] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // The shortlist rides along: the toggle state for twenty cards is ONE query, not one
      // per card, which is the N+1 the performance rule forbids.
      const [ranked, saved] = await Promise.all([
        listJobRecommendations(jobId),
        listSavedTalent().catch(() => ({ items: [], lists: [] })),
      ]);
      setMatches(ranked);
      setShortlisted(new Set(saved.items.map((row) => row.freelancerUserId)));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('match.loadError'));
    } finally {
      setLoading(false);
    }
  }, [jobId, t]);

  useEffect(() => { void load(); }, [load]);

  const toggleShortlist = async (userId: string) => {
    setBusy(`save:${userId}`);
    setError(null);
    try {
      if (shortlisted.has(userId)) {
        await unsaveTalent(userId);
        setShortlisted((prev) => { const next = new Set(prev); next.delete(userId); return next; });
      } else {
        await saveTalent({ freelancerUserId: userId });
        setShortlisted((prev) => new Set(prev).add(userId));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('shortlist.failed'));
    } finally {
      setBusy(null);
    }
  };

  const invite = async (userId: string) => {
    setBusy(`invite:${userId}`);
    setError(null);
    try {
      await inviteToJob(jobId, { freelancerUserId: userId, message: message.trim() || undefined });
      setInvitedNow((prev) => new Set(prev).add(userId));
      setMessageFor(null);
      setMessage('');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('invite.failed'));
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-small)' }}>{t('match.loading')}</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      <div>
        <h3 style={{ margin: '0 0 4px', fontSize: 'var(--font-size-card-title)', fontWeight: 700, color: 'var(--text-primary)' }}>
          {t('match.heading')}
        </h3>
        <p style={{ margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', maxWidth: '65ch' }}>
          {t('match.explainer')}
        </p>
      </div>

      {error && <div style={{ ...card, color: 'var(--coral-bright)', fontSize: 'var(--font-size-small)' }}>{error}</div>}

      {matches.length === 0 ? (
        <div style={{ ...card, textAlign: 'center', padding: 32, color: 'var(--text-muted)', fontSize: 'var(--font-size-small)' }}>
          {t('match.empty')}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 320px), 1fr))' }}>
          {matches.map((match) => {
            const alreadyInvited = match.invited || invitedNow.has(match.freelancerUserId);
            return (
              <div key={match.freelancerUserId} style={card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                  <Link
                    href={`/talent/${match.freelancerUserId}`}
                    style={{ fontSize: 'var(--font-size-body)', fontWeight: 700, color: 'var(--text-primary)', textDecoration: 'none', minWidth: 0, overflowWrap: 'anywhere' }}
                  >
                    {match.displayName ?? t('match.unnamed')}
                  </Link>
                  {match.rating != null && match.ratingCount > 0 && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: 'var(--warning-text, var(--warning))', fontWeight: 600, fontSize: 'var(--font-size-small)', flexShrink: 0 }}>
                      <Icon name="sparkles" size={13} /> {match.rating.toFixed(1)}
                      <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({match.ratingCount})</span>
                    </span>
                  )}
                </div>

                {match.headline && (
                  <p style={{ margin: '4px 0 8px', fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>{match.headline}</p>
                )}

                <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', marginBottom: 8 }}>
                  {match.hourlyRateCents != null && `${formatCents(match.hourlyRateCents, { currency: match.currency, maximumFractionDigits: 0 })}${t('perHour')} · `}
                  {t('match.completed', { count: match.completedEngagements })}
                </div>

                <MatchScore score={match.score} reasons={match.reasons} />
                <MatchSkills matched={match.matchedSkills} missing={match.missingSkills} />

                <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    disabled={busy === `save:${match.freelancerUserId}`}
                    aria-pressed={shortlisted.has(match.freelancerUserId)}
                    onClick={() => void toggleShortlist(match.freelancerUserId)}
                    style={{
                      ...ghostButton,
                      borderColor: shortlisted.has(match.freelancerUserId) ? 'var(--coral-bright)' : 'var(--border-subtle)',
                      color: shortlisted.has(match.freelancerUserId) ? 'var(--coral-bright)' : 'var(--text-primary)',
                    }}
                  >
                    {shortlisted.has(match.freelancerUserId) ? t('shortlist.saved') : t('shortlist.save')}
                  </button>

                  {alreadyInvited ? (
                    <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', alignSelf: 'center' }}>
                      <Icon name="check" size={13} /> {t('invite.sent')}
                    </span>
                  ) : messageFor === match.freelancerUserId ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
                      <textarea
                        style={{
                          background: 'var(--bg-elevated)', color: 'var(--text-primary)',
                          border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)',
                          padding: '7px 10px', fontSize: 'var(--font-size-small)', minHeight: 56, resize: 'vertical',
                          width: '100%', boxSizing: 'border-box',
                        }}
                        placeholder={t('invite.messagePlaceholder')}
                        value={message}
                        maxLength={2000}
                        onChange={(e) => setMessage(e.target.value)}
                      />
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          type="button"
                          style={primaryButton}
                          disabled={busy === `invite:${match.freelancerUserId}`}
                          onClick={() => void invite(match.freelancerUserId)}
                        >
                          {busy === `invite:${match.freelancerUserId}` ? t('invite.sending') : t('invite.send')}
                        </button>
                        <button type="button" style={ghostButton} onClick={() => { setMessageFor(null); setMessage(''); }}>
                          {t('invite.cancel')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" style={primaryButton} onClick={() => { setMessageFor(match.freelancerUserId); setMessage(''); }}>
                      {t('invite.action')}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
