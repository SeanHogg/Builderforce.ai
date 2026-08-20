'use client';

/**
 * The candidate's booking page — /book/<token>
 *
 * ── THE ONE SURFACE SOMEONE OUTSIDE THE TENANT EVER SEES ─────────────────────────
 * Every other page in this app is used by an operator. This one is opened by a person
 * being interviewed: no account, no session, quite possibly on a phone, on a link they
 * were sent by email. So it renders no shell chrome (see `NO_CHROME_PREFIXES`), asks for
 * nothing, and shows nothing about the company beyond the times on offer — the token
 * resolves to one interview's slots and the API deliberately returns no candidate name,
 * no interviewer names and no job title.
 *
 * ── WHY THE PAGE IS A SERVER SHELL AND THIS IS THE ISLAND ────────────────────────
 * The route needs one interactive region — fetch the offer, click a slot — and nothing
 * else. Rooting the whole page in the client would put the layout, the copy and the
 * shell in the bundle to buy a list of buttons, and the architecture ratchet counts
 * client-rooted pages for exactly that reason. The page stays a server component and
 * this is the island it mounts.
 *
 * ── WHY IT SHOWS TIMES IN THE VIEWER'S OWN ZONE ──────────────────────────────────
 * `toLocaleString` with the browser's resolved zone, and the zone is NAMED on the page.
 * A slot list that does not say which timezone it is in is the single most common way a
 * candidate turns up an hour late, and it is the recruiter who pays for it.
 */

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { bookingApi, type BookingView, type OfferedSlot } from '@/lib/hiringApi';
import { useFormat } from "@/i18n/useFormat";

type Status = 'loading' | 'ready' | 'invalid' | 'booked';

export function BookingClient({ token }: { token: string }) {
    const fmt = useFormat();
  const t = useTranslations('booking');
  const locale = useLocale();

  const [status, setStatus] = useState<Status>('loading');
  const [view, setView] = useState<BookingView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The viewer's OWN zone, not the one stored on the interview: the stored zone is what
  // the recruiter believed, and this is where the person actually is. Naming it on the
  // page is what makes the two reconcilable if they disagree.
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  const load = useCallback(async () => {
    try {
      const next = await bookingApi.read(token);
      setView(next);
      setStatus(next.booked ? 'booked' : 'ready');
    } catch {
      setStatus('invalid');
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  async function book(slot: OfferedSlot) {
    setBusy(slot.startISO);
    setError(null);
    try {
      await bookingApi.book(token, slot.startISO);
      setStatus('booked');
      setView((current) => (current ? { ...current, booked: true, bookedAt: slot.startISO } : current));
    } catch (caught) {
      // A 409 means somebody took it or an interviewer's calendar moved — both are
      // "choose another", so the list is reloaded rather than left showing a slot that
      // is gone. Anything else is a genuine failure and says so.
      const message = caught instanceof Error ? caught.message : '';
      setError(/409|taken|unavailable/i.test(message) ? t('taken') : t('failed'));
      await load();
    } finally {
      setBusy(null);
    }
  }

  const formatSlot = (slot: OfferedSlot) => fmt.dateWith(slot.startISO, {
      weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: timezone,
    });

  const slots = view?.slots ?? [];

  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        padding: 'clamp(16px, 5vw, 48px)',
        background: 'var(--bg-deep)',
        color: 'var(--text-primary)',
      }}
    >
      <div style={{ width: '100%', maxWidth: '32rem', display: 'grid', gap: '1rem' }}>
        {status === 'loading' && <p style={{ color: 'var(--text-secondary)' }}>{t('loading')}</p>}

        {status === 'invalid' && (
          <section style={card()}>
            <h1 style={heading()}>{t('expired')}</h1>
            <p style={body()}>{t('expiredDetail')}</p>
          </section>
        )}

        {status === 'booked' && (
          <section style={card()}>
            <h1 style={heading()}>{t('booked')}</h1>
            <p style={body()}>{t('bookedDetail')}</p>
            {view?.bookedAt && (
              <p style={{ ...body(), fontWeight: 600 }}>
                {fmt.dateWith(view.bookedAt, { dateStyle: 'full', timeStyle: 'short', timeZone: timezone })}
              </p>
            )}
          </section>
        )}

        {status === 'ready' && (
          <section style={card()}>
            <h1 style={heading()}>{t('title')}</h1>
            <p style={body()}>{t('intro', { timezone })}</p>
            <p style={{ ...body(), color: 'var(--text-secondary)' }}>
              {t('duration', { count: view?.durationMinutes ?? 30 })}
            </p>

            {error && (
              <p role="alert" style={{ ...body(), color: 'var(--error)' }}>{error}</p>
            )}

            {slots.length === 0 ? (
              <>
                <h2 style={{ ...heading(), fontSize: 'var(--font-size-card-title)' }}>{t('none')}</h2>
                <p style={body()}>{t('noneDetail')}</p>
              </>
            ) : (
              // `auto-fit` + `minmax` rather than a fixed column count: this is opened on
              // a phone as often as a laptop, and a two-column grid of timestamps overflows
              // a 360px viewport.
              <div style={{ display: 'grid', gap: '0.5rem', gridTemplateColumns: 'repeat(auto-fit, minmax(13rem, 1fr))' }}>
                {slots.map((slot) => (
                  <button
                    key={slot.startISO}
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void book(slot)}
                    aria-label={t('slotAria', { time: formatSlot(slot) })}
                    style={{
                      // 44px minimum: this is a touch target on a phone before it is
                      // anything else.
                      minHeight: '2.75rem',
                      padding: '0.75rem 1rem',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--border)',
                      background: busy === slot.startISO ? 'var(--surface-2)' : 'var(--surface)',
                      color: 'var(--text-primary)',
                      font: 'inherit',
                      cursor: busy ? 'progress' : 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    {busy === slot.startISO ? t('booking') : formatSlot(slot)}
                  </button>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}

/** Inline styles rather than a module: this page is deliberately self-contained, and
 *  every value is a theme token, so it follows the viewer's theme like everything else.
 *  It used to carry a DARK literal beside each token as a fallback — which was the one
 *  way this page could have rendered dark-on-dark in light mode, since the root layout
 *  loads `globals.css` on every route and the tokens have never been absent. */
function card(): React.CSSProperties {
  return {
    display: 'grid',
    gap: '0.75rem',
    padding: 'clamp(16px, 4vw, 28px)',
    borderRadius: 'var(--radius-lg)',
    border: '1px solid var(--border)',
    background: 'var(--surface)',
  };
}

function heading(): React.CSSProperties {
  return { margin: 0, fontSize: 'clamp(1.15rem, 4vw, 1.5rem)', color: 'var(--text-primary)' };
}

function body(): React.CSSProperties {
  return { margin: 0, lineHeight: 1.5, color: 'var(--text-primary)' };
}
