'use client';

/**
 * The RECIPIENT's read of a `legalDocument` share link — the other end of
 * `canvas_legal_document_share`'s token, and the page that was missing: the
 * link was always real (`GET /api/public/legal-documents/:token` and
 * `.../download` already resolved it), there was simply nowhere for a
 * recipient to land when they opened it.
 *
 * Same shape as `SignerConsole.tsx` (this file's sibling in spirit): resolve
 * the token first, say plainly when it is not valid, and never assume a
 * session — the recipient has none, by construction.
 *
 * The file itself is never fetched here. `legalDocumentShareFileUrl(token)` is
 * a plain address; the browser (an `<a>` navigation, opened in a new tab)
 * streams it directly from the API, and the server's own
 * `Content-Disposition` — `inline` for a 'view' share, `attachment` for a
 * 'download' one — is what actually enforces the distinction the recipient
 * experiences. Re-fetching the bytes into a blob here would buy nothing and
 * would mean holding a legal document's plaintext in page memory for no reason.
 */

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { legalDocumentShareFileUrl, publicLegalDocumentShare, type PublicLegalDocumentShare } from '@/lib/legalDocumentApi';
import styles from '../signature/SignerConsole.module.css';

type State =
  | { status: 'loading' }
  | { status: 'ready'; document: PublicLegalDocumentShare }
  | { status: 'missing' };

export function LegalDocumentShareViewer({ token }: { token: string }) {
  const t = useTranslations('legalDocumentShare');
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    publicLegalDocumentShare(token)
      .then((document) => { if (!cancelled) setState({ status: 'ready', document }); })
      .catch(() => { if (!cancelled) setState({ status: 'missing' }); });
    return () => { cancelled = true; };
  }, [token]);

  if (state.status === 'loading') {
    return <main className={styles.page}><div className={styles.sheet}><p className={styles.notice}>{t('loading')}</p></div></main>;
  }
  if (state.status === 'missing') {
    return <main className={styles.page} role="alert"><div className={styles.sheet}><p className={styles.notice}>{t('invalid')}</p></div></main>;
  }

  const { document, permission } = { document: state.document, permission: state.document.permission };
  const fileUrl = legalDocumentShareFileUrl(token);

  return (
    <main className={styles.page}>
      <div className={styles.sheet}>
        <p className={styles.eyebrow}>{t('eyebrow')}</p>
        <h1 className={styles.title}>{document.title}</h1>
        <p className={styles.addressed}>
          {permission === 'download' ? t('permissionDownload') : t('permissionView')}
        </p>

        <div className={styles.panel}>
          <a
            className={styles.primary}
            href={fileUrl}
            target="_blank"
            rel="noopener noreferrer"
            {...(permission === 'download' ? { download: document.filename } : {})}
          >
            {permission === 'download' ? t('downloadButton') : t('openButton')}
          </a>
          <p className={styles.help}>{permission === 'download' ? t('downloadHelp') : t('viewHelp')}</p>
        </div>
      </div>
    </main>
  );
}
