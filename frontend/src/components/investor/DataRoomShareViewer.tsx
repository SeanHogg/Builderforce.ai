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
 * The WATERMARK is stated rather than implied. A watermarked room stamps every page
 * a firm opens — a PDF diagonally and in the footer, a text document top and bottom
 * — with the reader's own address and the instant. A format the stamp cannot reach
 * at all is served view-only and SAYS so on its own row, because a recipient who
 * believes they have a private copy and does not is exactly the person this control
 * exists to inform.
 *
 * MISSING documents are listed. A diligence room that showed only the files that
 * exist would hide the gap it was built to close; a row that is not yet provided is
 * drawn as unavailable rather than omitted, which is also what stops a firm
 * concluding a room is complete when it is not.
 *
 * The bytes are never fetched here. `dataRoomDocumentUrl(token, id)` is a plain
 * address the browser streams from, and the server's own `Content-Disposition` is
 * what actually enforces the distinction the reader experiences — `attachment` for
 * a copy that carries the stamp, `inline` for one that could not.
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
  /**
   * Whether THIS document can be saved to disk.
   *
   * A watermarked room used to refuse every download outright, because a PDF could
   * not be stamped. Now that it can, a STAMPED copy is safe to hand over — it
   * carries the reader's own address on every page. What still cannot be saved is a
   * format the stamp cannot reach, and that is a per-document fact rather than a
   * per-room one, which is why it is decided here and not once above.
   *
   * The server decides the same thing again from the same inputs; this only keeps
   * the button from promising something the response would refuse.
   */
  const canSave = (document: { watermarkable: boolean }) =>
    share.permission === 'download' && (!share.watermark || document.watermarkable);

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
                  <small>
                    {document.category}
                    {document.required ? ` · ${t('required')}` : ''}
                    {/* A watermarked room CAN stamp a PDF now, so the note only
                        appears for the formats it genuinely cannot reach — and it
                        appears on the row, where the reader is deciding whether to
                        open it, rather than in a banner they have already scrolled
                        past. */}
                    {share.watermark && !document.watermarkable ? ` · ${t('viewOnly')}` : ''}
                  </small>
                </span>
                {document.available ? (
                  <a
                    className={styles.primary}
                    href={dataRoomDocumentUrl(token, document.documentId)}
                    target="_blank"
                    rel="noopener noreferrer"
                    {...(canSave(document) ? { download: document.label } : {})}
                  >
                    {canSave(document) ? t('download') : t('open')}
                  </a>
                ) : (
                  <small className={styles.help}>{t('notProvided')}</small>
                )}
              </li>
            ))}
          </ul>
          {share.documents.length === 0 && <p className={styles.help}>{t('empty')}</p>}
          <p className={styles.help}>{share.watermark ? t('viewHelpWatermarked') : share.permission === 'download' ? t('downloadHelp') : t('viewHelp')}</p>
          {/* Named separately from the watermark banner because it is a different
              fact: the room stamps, AND these particular files cannot be stamped, so
              they open in a tab and never save. Saying it once, plainly, beats a
              download button that silently returns an inline response. */}
          {share.watermark && available.some((document) => !document.watermarkable) && (
            <p className={styles.help}>{t('unstampableHelp', { count: available.filter((document) => !document.watermarkable).length })}</p>
          )}
        </div>
      </div>
    </main>
  );
}
