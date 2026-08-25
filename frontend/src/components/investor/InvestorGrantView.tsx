'use client';

/**
 * The FUND's read of a company grant — the other end of IN-2's token.
 *
 * Same shape as `DataRoomShareViewer`, `LegalDocumentShareViewer` and
 * `SignerConsole`, and the same reasoning: resolve the token first, say plainly
 * when it is not valid, and never assume a session — the firm reading this has
 * none, by construction.
 *
 * ── WHAT IS DIFFERENT FROM A ROOM LINK, AND WHY IT MATTERS HERE ─────────────
 * A room link opens ONE room. This opens the COMPANY: every room it holds now,
 * and every room it holds later, behind ONE NDA. So the first screen is a list of
 * rooms rather than a list of documents, and picking one derives the per-room
 * share server-side on that call — which is why a room built after the invitation
 * went out appears in this list without anybody reissuing anything.
 *
 * ── THE THREE THINGS THIS PAGE STILL HAS TO SHOW HONESTLY ──────────────────
 * `nda-pending` is not an error. It is a valid grant with one thing left to do,
 * and a page that showed "invalid" for it would send a fund back to the founder
 * asking for a link that would behave identically.
 *
 * The WATERMARK is stated rather than implied, and a format the stamp cannot
 * reach is marked view-only on its own row — a reader who believes they have a
 * private copy and does not is exactly the person that control exists to inform.
 *
 * MISSING documents are listed. A diligence room that showed only the files that
 * exist would hide the gap it was built to close.
 *
 * The bytes are never fetched here: `investorDocumentUrl` is a plain address the
 * browser streams from, and the server's own `Content-Disposition` is what
 * enforces the distinction the reader experiences.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { PublicDataRoomShare } from '@/lib/founderOpsApi';
import {
  investorDocumentUrl,
  publicInvestorGrant,
  publicInvestorRoom,
  type PublicInvestorGrant,
} from '@/lib/investorApi';
import styles from '../signature/SignerConsole.module.css';

type State =
  | { status: 'loading' }
  | { status: 'ready'; grant: PublicInvestorGrant }
  | { status: 'nda'; companyName: string; ndaState: string }
  | { status: 'missing' };

export function InvestorGrantView({ token }: { token: string }) {
  const t = useTranslations('investorGrant');
  const tRoom = useTranslations('dataRoomShare');
  const [state, setState] = useState<State>({ status: 'loading' });
  const [openRoomId, setOpenRoomId] = useState<number | null>(null);
  const [room, setRoom] = useState<PublicDataRoomShare | null>(null);
  const [roomNotice, setRoomNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    publicInvestorGrant(token)
      .then((view) => {
        if (cancelled) return;
        setState(view.outcome === 'ok'
          ? { status: 'ready', grant: view.grant }
          : { status: 'nda', companyName: view.companyName, ndaState: view.ndaState });
      })
      .catch(() => { if (!cancelled) setState({ status: 'missing' }); });
    return () => { cancelled = true; };
  }, [token]);

  const openRoom = useCallback((roomId: number) => {
    setOpenRoomId(roomId);
    setRoom(null);
    setRoomNotice(null);
    publicInvestorRoom(token, roomId)
      .then((view) => {
        if (view.outcome === 'ok') setRoom(view.share);
        else setRoomNotice(view.ndaState === 'declined' ? tRoom('ndaDeclined') : view.ndaState === 'expired' ? tRoom('ndaExpired') : tRoom('ndaPending'));
      })
      .catch(() => setRoomNotice(tRoom('invalid')));
  }, [tRoom, token]);

  if (state.status === 'loading') {
    return <main className={styles.page}><div className={styles.sheet}><p className={styles.notice}>{t('loading')}</p></div></main>;
  }
  if (state.status === 'missing') {
    return <main className={styles.page} role="alert"><div className={styles.sheet}><p className={styles.notice}>{t('invalid')}</p></div></main>;
  }
  if (state.status === 'nda') {
    return (
      <main className={styles.page}>
        <div className={styles.sheet}>
          <p className={styles.eyebrow}>{t('eyebrow')}</p>
          <h1 className={styles.title}>{state.companyName}</h1>
          <p className={styles.addressed} role="status">
            {state.ndaState === 'declined' ? tRoom('ndaDeclined') : state.ndaState === 'expired' ? tRoom('ndaExpired') : tRoom('ndaPending')}
          </p>
          {/* ONE NDA covers the whole company, not one room. Saying so is what
              stops a fund signing and then expecting a second request per room. */}
          <p className={styles.help}>{t('ndaHelp')}</p>
        </div>
      </main>
    );
  }

  const { grant } = state;

  return (
    <main className={styles.page}>
      <div className={styles.sheet}>
        <p className={styles.eyebrow}>{t('eyebrow')}</p>
        <h1 className={styles.title}>{grant.companyName}</h1>
        <p className={styles.addressed}>
          {t('addressed', { name: grant.recipientName || grant.recipientEmail })}
          {grant.expiresAt ? ` ${t('expires', { date: grant.expiresAt.slice(0, 10) })}` : ''}
        </p>

        <div className={styles.panel}>
          <span className={styles.label}>{t('roomsLabel', { count: grant.rooms.length })}</span>
          {grant.rooms.length === 0 ? (
            <p className={styles.help}>{t('noRooms')}</p>
          ) : (
            <ul className={styles.documentList}>
              {grant.rooms.map((entry) => (
                <li key={entry.id} className={styles.documentRow} data-available="true">
                  <span className={styles.documentName}>
                    <b>{entry.name}</b>
                    <small>{entry.purpose || t('noPurpose')}{entry.watermark ? ` · ${t('watermarked')}` : ''}</small>
                  </span>
                  <button type="button" className={styles.primary} onClick={() => openRoom(entry.id)}>
                    {openRoomId === entry.id ? t('reopen') : t('open')}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {/* The grant reaches rooms that do not exist yet. Stated, because a fund
              that bookmarks this page needs to know it is worth returning to. */}
          <p className={styles.help}>{t('futureRooms')}</p>
        </div>

        {roomNotice && <p className={styles.notice} role="status">{roomNotice}</p>}

        {room && (
          <div className={styles.panel}>
            <span className={styles.label}>{room.roomName}</span>
            {room.watermark && (
              <p className={styles.notice} role="status">
                {tRoom('watermarked', { label: room.watermarkLabel ?? room.recipientEmail ?? '' })}
              </p>
            )}
            <ul className={styles.documentList}>
              {room.documents.map((document) => {
                // Decided per DOCUMENT, not per room: a stamped copy is safe to
                // hand over because it carries the reader's own address, and a
                // format the stamp cannot reach can only ever be opened in a tab.
                const canSave = room.permission === 'download' && (!room.watermark || document.watermarkable);
                return (
                  <li key={document.documentId} className={styles.documentRow} data-available={document.available ? 'true' : 'false'}>
                    <span className={styles.documentName}>
                      <b>{document.label}</b>
                      <small>
                        {document.category}
                        {document.required ? ` · ${tRoom('required')}` : ''}
                        {room.watermark && !document.watermarkable ? ` · ${tRoom('viewOnly')}` : ''}
                      </small>
                    </span>
                    {document.available ? (
                      <a
                        className={styles.primary}
                        href={investorDocumentUrl(token, room.dataRoomId, document.documentId)}
                        target="_blank"
                        rel="noopener noreferrer"
                        {...(canSave ? { download: document.label } : {})}
                      >
                        {canSave ? tRoom('download') : tRoom('open')}
                      </a>
                    ) : (
                      <small className={styles.help}>{tRoom('notProvided')}</small>
                    )}
                  </li>
                );
              })}
            </ul>
            {room.documents.length === 0 && <p className={styles.help}>{tRoom('empty')}</p>}
          </div>
        )}
      </div>
    </main>
  );
}
