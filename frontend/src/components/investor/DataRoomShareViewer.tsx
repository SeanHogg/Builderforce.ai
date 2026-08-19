'use client';

/**
 * The RECIPIENT's read of a data-room link — the other end of
 * `canvas_share_data_room`'s token (FO-E2).
 *
 * Same shape as `LegalDocumentShareViewer` and `SignerConsole`, and the same
 * reasoning: resolve the token first, say plainly when it is not valid, and never
 * assume a session — the firm reading this has none, by construction.
 *
 * ── THE THREE THINGS THIS PAGE HAS TO SHOW HONESTLY ─────────────────────────
 * `nda-pending` is not an error. It is a valid link with one thing left to do, and
 * a page that showed "invalid" for it would send a fund back to the founder asking
 * for a new link that would behave identically. It says which, and says where the
 * signing request went.
 *
 * The WATERMARK is stated rather than implied. A watermarked room serves text
 * documents stamped with the reader's own address and the instant, and refuses to
 * hand over a download at all — so the banner says so, because a recipient who
 * believes they have a private copy and does not is the person this control exists
 * to inform.
 *
 * MISSING documents are listed. A diligence room that showed only the files that
 * exist would hide the gap it was built to close; a row that is not yet provided is
 * drawn as unavailable rather than omitted, which is also what stops a firm
 * concluding a room is complete when it is not.
 *
 * The bytes are never fetched here. `dataRoomDocumentUrl(token, id)` is a plain
 * address the browser streams from, and the server's own `Content-Disposition` —
 * always `inline` for a watermarked room — is what actually enforces the
 * distinction the reader experiences.
 */

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { dataRoomDocumentUrl, publicDataRoom, type PublicDataRoomShare } from '@/lib/founderOpsApi';
import styles from '../signature/SignerConsole.module.css';

type State =
  | { status: 'loading' }
  | { status: 'ready'; share: PublicDataRoomShare }
  | { status: 'nda'; roomName: string; ndaState: string }
  | { status: 'missing' };

export function DataRoomShareViewer({ token }: { token: string }) {
  const t = useTranslations('dataRoomShare');
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    publicDataRoom(token)
      .then((view) => {
        if (cancelled) return;
        setState(view.outcome === 'ok'
          ? { status: 'ready', share: view.share }
          : { status: 'nda', roomName: view.roomName, ndaState: view.ndaState });
      })
      .catch(() => { if (!cancelled) setState({ status: 'missing' }); });
    return () => { cancelled = true; };
  }, [token]);

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
          <h1 className={styles.title}>{state.roomName}</h1>
          <p className={styles.addressed} role="status">
            {state.ndaState === 'declined' ? t('ndaDeclined') : state.ndaState === 'expired' ? t('ndaExpired') : t('ndaPending')}
          </p>
          <p className={styles.help}>{t('ndaHelp')}</p>
        </div>
      </main>
    );
  }

  const { share } = state;
  const available = share.documents.filter((document) => document.available);

  return (
    <main className={styles.page}>
      <div className={styles.sheet}>
        <p className={styles.eyebrow}>{t('eyebrow')}</p>
        <h1 className={styles.title}>{share.roomName}</h1>
        <p className={styles.addressed}>
          {share.recipientName ? t('addressed', { name: share.recipientName }) : t('addressedAnon')}
          {share.expiresAt ? ` ${t('expires', { date: share.expiresAt.slice(0, 10) })}` : ''}
        </p>

        {share.watermark && (
          <p className={styles.notice} role="status">
            {t('watermarked', { label: share.watermarkLabel ?? share.recipientEmail ?? '' })}
          </p>
        )}

        <div className={styles.panel}>
          <span className={styles.label}>{t('documentsLabel', { count: available.length, total: share.documents.length })}</span>
          <ul className={styles.documentList}>
            {share.documents.map((document) => (
              <li key={document.documentId} className={styles.documentRow} data-available={document.available ? 'true' : 'false'}>
                <span className={styles.documentName}>
                  <b>{document.label}</b>
                  <small>{document.category}{document.required ? ` · ${t('required')}` : ''}</small>
                </span>
                {document.available ? (
                  <a
                    className={styles.primary}
                    href={dataRoomDocumentUrl(token, document.documentId)}
                    target="_blank"
                    rel="noopener noreferrer"
                    {...(share.permission === 'download' && !share.watermark ? { download: document.label } : {})}
                  >
                    {share.permission === 'download' && !share.watermark ? t('download') : t('open')}
                  </a>
                ) : (
                  <small className={styles.help}>{t('notProvided')}</small>
                )}
              </li>
            ))}
          </ul>
          {share.documents.length === 0 && <p className={styles.help}>{t('empty')}</p>}
          <p className={styles.help}>{share.watermark ? t('viewHelpWatermarked') : share.permission === 'download' ? t('downloadHelp') : t('viewHelp')}</p>
        </div>
      </div>
    </main>
  );
}
