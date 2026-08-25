/**
 * WHAT THIS WORKSPACE HAS EARNED, AND THE PROGRAMS IT IS IN.
 *
 * ── THE FEE IS STATED OUT LOUD ──────────────────────────────────────────────
 * A fee nobody can inspect is indistinguishable from a fee nobody agreed to, and
 * it is the most common reason a marketplace loses its supply side. So the rate,
 * the threshold and which side of it this publisher is on are all shown — read
 * from the server's own schedule (`revShare`, projected from the SAME env vars the
 * charge path reads), never recomputed here. A page that quoted its own numbers is
 * how a partner is told one rate and charged another.
 *
 * ── THE BALANCE IS THE WORKSPACE'S, NOT A PERSON'S ──────────────────────────
 * An extension names no author, so its revenue accrues to the publishing
 * workspace. That is why the payout destination is NOMINATED here rather than
 * inherited from whoever is looking at the page — a company's revenue must not
 * follow an employee.
 *
 * ── AND WHY A TRACK CANNOT BE JOINED FROM THIS PAGE ─────────────────────────
 * PRD 24 §2.1: the funnel that works has a human at the top. Featured placement's
 * whole value is that not everybody has it, so a self-serve "join" button would
 * spend the benefit it was granting. This page SHOWS what each track offers,
 * because that is what a vendor needs before deciding to ask.
 *
 * ── NO `use client` DIRECTIVE, DELIBERATELY ─────────────────────────────────
 * Imported only by `DeveloperPortalContent`, which is already the boundary. A
 * module imported by a client module IS client code either way, so the directive
 * would mark nothing and change nothing except the architecture ratchet's count —
 * the finding its own changelog records three separate times.
 */

import { useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import {
  developerApi,
  type PartnerStanding,
  type PublisherEarnings,
} from '@/lib/builderforceApi';

const card: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  padding: 20,
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
};

const sectionTitle: React.CSSProperties = {
  fontSize: 'var(--font-size-body)',
  fontWeight: 700,
  color: 'var(--text-primary)',
};

const muted: React.CSSProperties = { fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' };

const figure: React.CSSProperties = {
  fontSize: 'var(--font-size-section, 1.4rem)',
  fontWeight: 700,
  color: 'var(--text-primary)',
};

const button: React.CSSProperties = {
  padding: '8px 14px',
  fontSize: 'var(--font-size-small)',
  fontWeight: 600,
  background: 'var(--surface-interactive)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-md)',
  cursor: 'pointer',
  minHeight: 36,
};

const input: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  fontSize: 'var(--font-size-small)',
  background: 'var(--bg-elevated, var(--bg-base))',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-md)',
  minHeight: 36,
};

const grid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
  gap: 14,
};

const chip = (tone: 'neutral' | 'good'): React.CSSProperties => ({
  display: 'inline-block',
  padding: '2px 8px',
  fontSize: 'var(--font-size-eyebrow)',
  fontWeight: 600,
  borderRadius: 'var(--radius-full)',
  border: '1px solid var(--border-subtle)',
  color: tone === 'good' ? 'var(--success-text)' : 'var(--text-secondary)',
  whiteSpace: 'nowrap',
});

type Props = {
  busy: string | null;
  onRun: (key: string, fn: () => Promise<unknown>) => Promise<void>;
};

export function PublisherEarningsPanel({ busy, onRun }: Props) {
  const t = useTranslations('developerPortal.earnings');
  const tp = useTranslations('developerPortal.programs');
  const format = useFormatter();

  const [earnings, setEarnings] = useState<PublisherEarnings | null>(null);
  const [standing, setStanding] = useState<PartnerStanding | null>(null);
  const [destination, setDestination] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Both reads at once: they are independent, and serialising them would show
    // two spinners on one screen.
    void Promise.all([developerApi.earnings(), developerApi.programs()])
      .then(([e, s]) => {
        if (cancelled) return;
        setEarnings(e);
        setStanding(s);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : t('loadFailed'));
      });
    return () => { cancelled = true; };
  }, [t]);

  /** Cents → the reader's own currency formatting. Never a hand-rolled `$${n}`. */
  const money = (cents: number) =>
    format.number(cents / 100, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

  if (error) return <p role="alert" style={{ ...muted, color: 'var(--coral-bright)' }}>{error}</p>;
  if (!earnings || !standing) return <p style={muted}>{t('loading')}</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <section style={card}>
        <h2 style={sectionTitle}>{t('title')}</h2>
        <div style={grid}>
          <div>
            <p style={muted}>{t('available')}</p>
            <p style={figure}>{money(earnings.availableCents)}</p>
          </div>
          <div>
            <p style={muted}>{t('earned')}</p>
            <p style={figure}>{money(earnings.earnedCents)}</p>
          </div>
          <div>
            <p style={muted}>{t('paid')}</p>
            <p style={figure}>{money(earnings.paidCents)}</p>
          </div>
        </div>

        {/* The fee, and WHY it is that number for this publisher. */}
        <p style={muted}>
          {earnings.underThreshold
            ? t('underThreshold', { threshold: money(earnings.thresholdCents) })
            : t('standardRate', {
                percent: format.number(earnings.takeRateBps / 100, { maximumFractionDigits: 2 }),
                threshold: money(earnings.thresholdCents),
              })}
        </p>

        {!earnings.payoutConnected && (
          <p role="note" style={{ ...muted, color: 'var(--coral-bright)' }}>{t('noDestination')}</p>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: 10, alignItems: 'end' }}>
          <label style={muted} htmlFor="payout-destination">
            {t('destinationLabel')}
            <input
              id="payout-destination"
              style={input}
              inputMode="numeric"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              placeholder={t('destinationPlaceholder')}
            />
          </label>
          <button
            type="button"
            style={button}
            disabled={busy === 'payout-destination'}
            onClick={() =>
              void onRun('payout-destination', async () => {
                const id = Number(destination.trim());
                await developerApi.setPayoutDestination(Number.isInteger(id) && id > 0 ? id : null);
                setEarnings(await developerApi.earnings());
              })
            }
          >
            {t('saveDestination')}
          </button>
        </div>

        <button
          type="button"
          style={button}
          disabled={earnings.availableCents <= 0 || !earnings.payoutConnected || busy === 'payout'}
          onClick={() =>
            void onRun('payout', async () => {
              // The AMOUNT is the server's. An endpoint that accepted one would pay
              // whatever a crafted request asked for, so there is nothing to send.
              const result = await developerApi.payout();
              if (!result.ok && result.error) setError(result.error);
              setEarnings(await developerApi.earnings());
            })
          }
        >
          {earnings.availableCents > 0 ? t('payout', { amount: money(earnings.availableCents) }) : t('nothing')}
        </button>
      </section>

      <section style={card}>
        <h2 style={sectionTitle}>{tp('title')}</h2>
        <p style={muted}>
          {tp('yourTrack', { track: tp(`track.${standing.track}` as 'track.none') })}{' '}
          {standing.featuredAtISO && <span style={chip('good')}>{tp('featured')}</span>}
        </p>
        <p style={{ ...muted, maxWidth: '70ch' }}>{tp('arrangedWithUs')}</p>

        <div style={grid}>
          {standing.tracks.map((track) => (
            <article
              key={track.track}
              style={{
                ...card,
                padding: 16,
                // The track this publisher is actually in is marked, so the page
                // answers "where am I?" before "what else is there?".
                borderColor: track.track === standing.track ? 'var(--success-text)' : 'var(--border-subtle)',
              }}
            >
              <strong style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-primary)' }}>
                {tp(`track.${track.track}` as 'track.none')}
              </strong>
              <p style={muted}>{tp(`audience.${track.audienceKey}` as 'audience.selfServe')}</p>
              <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {track.benefits.map((b) => (
                  <li key={b.key} style={muted}>
                    {tp(`benefit.${b.key}` as 'benefit.openRegistration')}{' '}
                    {/* A benefit the platform DELIVERS is marked apart from one that
                        is a human commitment. A list that presented both the same way
                        would be promising things no code keeps. */}
                    <span style={chip(b.automated ? 'good' : 'neutral')}>
                      {b.automated ? tp('automatic') : tp('manual')}
                    </span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
