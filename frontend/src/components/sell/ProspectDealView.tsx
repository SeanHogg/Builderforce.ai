'use client';

/**
 * What the BUYER sees.
 *
 * ── THE ONE THING THIS PAGE MUST NOT DO ─────────────────────────────────────────
 * It must not look like a product they have to learn. A prospect opened a link somebody
 * sent them; the page has to answer "what is this, who is it from, and what do I do" above
 * the fold and then get out of the way. So there is no navigation, no sign-in prompt, no
 * platform chrome — the masthead is the SELLER's name, not ours.
 *
 * ── WHY THE CARD RENDERER IS GENERIC ────────────────────────────────────────────
 * Six kinds can be shared and more will be. A per-kind component would be six components
 * that drift, and the fields they draw already have one declaration — the spec vocabulary.
 * So the page draws whatever the packet's projection sent, with two shapes it recognises
 * (a quote's priced lines, and a questionnaire/milestone table) and a generic renderer for
 * everything else. Adding a shareable kind costs nothing here, which is the property that
 * keeps this page from becoming the place new kinds go to be forgotten.
 *
 * ── ENGAGEMENT IS MEASURED HONESTLY ─────────────────────────────────────────────
 * Dwell is per CARD and only counts while the card is actually on screen and the tab is
 * visible: an IntersectionObserver starts a clock, `visibilitychange` stops it, and the
 * total is flushed on unmount and on `pagehide`. A "time on page" that keeps counting
 * behind a backgrounded tab is the number that makes every engagement report worthless,
 * and the seller's follow-up depends on this being real.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Formatter } from '@/i18n/format';
import { useTranslations } from 'next-intl';
import {
  quoteTotals, readMapMilestones, readQuoteLines, readTrustAnswers,
} from '@builderforce/creation-canvas-contract';
import { useMoneyFormat } from '@/lib/useMoneyFormat';
import {
  acceptProspectQuote, declineProspectQuote, fetchProspectPacket, reportProspectEvent,
  requestProspectControl, type ProspectCard, type ProspectPacket,
} from '@/lib/prospectShareApi';
import styles from './ProspectDealView.module.css';
import { useFormat } from "@/i18n/useFormat";

/** Fields drawn as their own labelled block by the generic renderer. Anything not listed
 *  is skipped rather than dumped: a buyer page that renders every key a card happens to
 *  carry is one that shows them `sourceSessionId`. */
const READABLE_FIELDS: readonly string[] = [
  'summary', 'terms', 'buyer', 'buyerContact', 'prospect', 'audience', 'counterparty',
  'commitment', 'nextStep', 'sentiment', 'outcome', 'targetGoLiveAt', 'expiresAt',
  'startsAt', 'heldAt', 'frameworks', 'activationCriteria', 'objections', 'documents',
];

const text = (fmt: Formatter, value: unknown): string => {
  if (value == null) return '';
  if (typeof value === 'number') return fmt.number(value);
  if (Array.isArray(value)) {
    return value.map((entry) => {
      if (entry && typeof entry === 'object') {
        const row = entry as Record<string, unknown>;
        const title = String(row.title ?? row.name ?? '').trim();
        const detail = String(row.detail ?? row.url ?? row.description ?? '').trim();
        return [title, detail].filter(Boolean).join(' — ');
      }
      return String(entry ?? '').trim();
    }).filter(Boolean).join('\n');
  }
  if (typeof value === 'object') return '';
  return String(value).trim();
};

const currencyOf = (data: Record<string, unknown>): string => {
  const code = String(data.currency ?? '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : 'USD';
};

/** Start a dwell clock for one card and flush it once. See the module header for why the
 *  visibility and intersection gates are both required. */
function useDwell(token: string, card: ProspectCard) {
  const ref = useRef<HTMLElement | null>(null);
  const seconds = useRef(0);
  const since = useRef<number | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;

    const stop = () => {
      if (since.current == null) return;
      seconds.current += (Date.now() - since.current) / 1000;
      since.current = null;
    };
    const start = () => { if (since.current == null) since.current = Date.now(); };

    let onScreen = false;
    const observer = new IntersectionObserver(([entry]) => {
      onScreen = !!entry?.isIntersecting;
      if (onScreen && document.visibilityState === 'visible') {
        // A card is only "viewed" once, however many times it scrolls back into frame.
        if (seconds.current === 0 && since.current == null) {
          reportProspectEvent(token, 'viewed', { canvasObjectId: card.id, objectLabel: card.title });
        }
        start();
      } else stop();
    }, { threshold: 0.4 });
    observer.observe(node);

    const onVisibility = () => {
      if (document.visibilityState === 'visible' && onScreen) start();
      else stop();
    };
    document.addEventListener('visibilitychange', onVisibility);

    const flush = () => {
      stop();
      const total = Math.round(seconds.current);
      if (total >= 2) {
        reportProspectEvent(token, 'dwell', { canvasObjectId: card.id, objectLabel: card.title, seconds: total });
        seconds.current = 0;
      }
    };
    window.addEventListener('pagehide', flush);

    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [token, card.id, card.title]);

  return ref;
}

function QuoteLines({ data }: { data: Record<string, unknown> }) {
  const { formatCents } = useMoneyFormat();
  const t = useTranslations('prospectDeal');
  const lines = useMemo(() => readQuoteLines(data.lines), [data.lines]);
  const totals = useMemo(
    () => quoteTotals(lines, Number(data.termMonths ?? 12)),
    [lines, data.termMonths],
  );
  const currency = currencyOf(data);
  if (lines.length === 0) return null;

  return <>
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">{t('lineItem')}</th>
            <th scope="col" className={styles.numeric}>{t('lineSeats')}</th>
            <th scope="col" className={styles.numeric}>{t('lineList')}</th>
            <th scope="col" className={styles.numeric}>{t('lineDiscount')}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => (
            <tr key={`${line.description}-${index}`}>
              <td>{line.description || line.plan}</td>
              <td className={styles.numeric}>{line.seats}</td>
              <td className={styles.numeric}>{formatCents(line.unitPriceCents, { currency })}</td>
              <td className={styles.numeric}>{line.discountPercent > 0 ? `${line.discountPercent}%` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <div className={styles.totals}>
      <div className={styles.totalLine}>
        <span className={styles.totalLabel}>{t('subtotal')}</span>
        <span className={styles.totalValue}>{formatCents(totals.subtotalCents, { currency })}</span>
      </div>
      {totals.discountCents > 0 && (
        <div className={styles.totalLine}>
          <span className={styles.totalLabel}>{t('discount')}</span>
          <span className={styles.totalValue}>
            −{formatCents(totals.discountCents, { currency })} ({totals.effectiveDiscountPercent}%)
          </span>
        </div>
      )}
      <div className={`${styles.totalLine} ${styles.grandTotal}`}>
        <span className={styles.totalLabel}>{t('perPeriod')}</span>
        <span className={styles.totalValue}>{formatCents(totals.totalCents, { currency })}</span>
      </div>
    </div>
  </>;
}

function QuestionnaireTable({ data }: { data: Record<string, unknown> }) {
  const t = useTranslations('prospectDeal');
  const answers = useMemo(() => readTrustAnswers(data.questionnaire), [data.questionnaire]);
  if (answers.length === 0) return null;
  return <div className={styles.tableWrap}>
    <table className={styles.table}>
      <thead>
        <tr>
          <th scope="col">{t('question')}</th>
          <th scope="col">{t('answer')}</th>
          <th scope="col">{t('evidence')}</th>
        </tr>
      </thead>
      <tbody>
        {answers.map((row, index) => (
          <tr key={`${row.question}-${index}`}>
            <td>{row.question}</td>
            <td>{row.answer || t(`answerState.${row.state}`)}</td>
            <td>{row.evidence || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>;
}

function MilestoneTable({ data }: { data: Record<string, unknown> }) {
  const t = useTranslations('prospectDeal');
  const milestones = useMemo(() => readMapMilestones(data.milestones), [data.milestones]);
  if (milestones.length === 0) return null;
  return <div className={styles.tableWrap}>
    <table className={styles.table}>
      <thead>
        <tr>
          <th scope="col">{t('milestone')}</th>
          <th scope="col">{t('due')}</th>
          <th scope="col">{t('ourOwner')}</th>
          <th scope="col">{t('yourOwner')}</th>
        </tr>
      </thead>
      <tbody>
        {milestones.map((row, index) => (
          <tr key={`${row.title}-${index}`}>
            <td>{row.title}</td>
            <td>{row.dueAtISO || '—'}</td>
            <td>{row.sellerOwner || '—'}</td>
            <td>{row.buyerOwner || t('unassigned')}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>;
}

function DealCard({ token, card, wide }: { token: string; card: ProspectCard; wide: boolean }) {
  const fmt = useFormat();
  const t = useTranslations('prospectDeal');
  const fieldT = useTranslations('creationCanvas.sellMotion.field');
  const ref = useDwell(token, card);

  const fields = READABLE_FIELDS
    .map((name) => ({ name, value: text(fmt, card.data[name]) }))
    .filter((entry) => entry.value);

  return <article ref={ref as React.Ref<HTMLElement>} className={`${styles.card} ${wide ? styles.wide : ''}`}>
    <header className={styles.cardHead}>
      <h2 className={styles.cardTitle}>{card.title || t(`kind.${card.kind}`)}</h2>
      {card.status && <span className={styles.pill}>{card.status}</span>}
    </header>

    {card.kind === 'quote' && <QuoteLines data={card.data} />}
    {card.kind === 'trustPacket' && <QuestionnaireTable data={card.data} />}
    {card.kind === 'mutualActionPlan' && <MilestoneTable data={card.data} />}

    {fields.map((entry) => (
      <div key={entry.name} className={styles.field}>
        <span className={styles.fieldLabel}>{fieldT(entry.name)}</span>
        <span className={styles.fieldValue}>{entry.value}</span>
      </div>
    ))}
  </article>;
}

export function ProspectDealView({ token }: { token: string }) {
  const { formatCents } = useMoneyFormat();
  const t = useTranslations('prospectDeal');
  const [packet, setPacket] = useState<ProspectPacket | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [settled, setSettled] = useState<'accepted' | 'declined' | 'controlRequested' | null>(null);

  useEffect(() => {
    let live = true;
    void fetchProspectPacket(token).then((next) => {
      if (!live) return;
      setPacket(next);
      setLoading(false);
      if (next) reportProspectEvent(token, 'opened');
    });
    return () => { live = false; };
  }, [token]);

  const accept = useCallback(async () => {
    if (!packet?.acceptable || !name.trim()) return;
    setBusy(true);
    setError('');
    const outcome = await acceptProspectQuote(token, {
      quoteObjectId: packet.acceptable.quoteObjectId,
      name: name.trim(),
      email: email.trim(),
    });
    setBusy(false);
    if (!outcome.ok) { setError(outcome.error); return; }
    setSettled('accepted');
    // The negotiated terms travel to checkout so the buyer is not sent to the public price
    // list to re-pick a plan — which is where every discount currently dies. Stored rather
    // than navigated: the buyer decides when to pay, and a page that redirects somebody who
    // just agreed feels like a trap.
    if (outcome.intent) {
      try {
        window.sessionStorage.setItem('builderforce.acceptedQuote', JSON.stringify(outcome.intent));
      } catch { /* a private-mode browser must not break an acceptance that already landed */ }
    }
  }, [packet, token, name, email]);

  const decline = useCallback(async () => {
    if (!packet?.acceptable) return;
    setBusy(true);
    await declineProspectQuote(token, { quoteObjectId: packet.acceptable.quoteObjectId, reason: '' });
    setBusy(false);
    setSettled('declined');
  }, [packet, token]);

  const askForControl = useCallback(async () => {
    setBusy(true);
    const raised = await requestProspectControl(token, { name: name.trim(), note: '' });
    setBusy(false);
    if (raised) setSettled('controlRequested');
  }, [token, name]);

  if (loading) {
    return <main className={styles.page}><p className={styles.unavailable}>{t('loading')}</p></main>;
  }
  if (!packet) {
    return <main className={styles.page} role="alert">
      <p className={styles.unavailable}>{t('unavailable')}</p>
    </main>;
  }

  const { settings } = packet;
  const accentStyle = settings.accentColor
    ? ({ ['--deal-accent' as string]: settings.accentColor } as React.CSSProperties)
    : undefined;

  return <main className={styles.page} style={accentStyle}>
    <div className={styles.shell}>
      <header className={styles.masthead}>
        <span className={styles.from}>
          {t('from')} <span className={styles.seller}>{settings.sellerCompany || settings.sellerName || t('aTeam')}</span>
        </span>
        <h1 className={styles.title}>{packet.title}</h1>
      </header>

      {settings.message && <p className={styles.message}>{settings.message}</p>}

      <div className={styles.cards}>
        {packet.cards.map((card) => (
          <DealCard key={card.id} token={token} card={card} wide={card.kind === 'quote' || packet.cards.length === 1} />
        ))}
        {packet.cards.length === 0 && <p className={styles.notice}>{t('nothingShared')}</p>}
      </div>

      {settled === 'accepted' && (
        <div className={`${styles.notice} ${styles.accepted}`} role="status">{t('acceptedNotice')}</div>
      )}
      {settled === 'declined' && <div className={styles.notice} role="status">{t('declinedNotice')}</div>}
      {settled === 'controlRequested' && <div className={styles.notice} role="status">{t('controlNotice')}</div>}
      {error && <div className={`${styles.notice} ${styles.error}`} role="alert">{error}</div>}

      {packet.acceptable && !settled && (
        <section className={styles.card} aria-label={t('acceptHeading')}>
          <h2 className={styles.cardTitle}>{t('acceptHeading')}</h2>
          <p className={styles.message}>
            {t('acceptBlurb', {
              amount: formatCents(packet.acceptable.totalCents, { currency: packet.acceptable.currency }),
            })}
          </p>
          <div className={styles.identity}>
            <input
              className={styles.input}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('yourName')}
              aria-label={t('yourName')}
              autoComplete="name"
            />
            <input
              className={styles.input}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder={t('yourEmailOptional')}
              aria-label={t('yourEmailOptional')}
              type="email"
              autoComplete="email"
            />
          </div>
          <div className={styles.actions}>
            <button type="button" className={styles.primary} onClick={accept} disabled={busy || !name.trim()}>
              {t('acceptAction')}
            </button>
            <button type="button" className={styles.secondary} onClick={decline} disabled={busy}>
              {t('declineAction')}
            </button>
          </div>
        </section>
      )}

      {settings.allowControlRequest && settled !== 'controlRequested' && (
        <div className={styles.actions}>
          <button type="button" className={styles.secondary} onClick={askForControl} disabled={busy}>
            {t('requestControlAction')}
          </button>
        </div>
      )}

      <p className={styles.footer}>{t('footer')}</p>
    </div>
  </main>;
}
