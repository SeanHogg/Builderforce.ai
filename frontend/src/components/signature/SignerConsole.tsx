'use client';

/**
 * The SIGNER's surface — what `contract.sign` was gating on and had nothing
 * behind.
 *
 * ── WHAT A SIGNATURE PAGE HAS TO GET RIGHT ──────────────────────────────────
 * Three things, and only the first is obvious.
 *
 * 1. It shows the TERMS, verbatim, above the control that agrees to them. The
 *    body was frozen onto the request when it was sent — the evidence an auditor
 *    needs is what THIS person saw on THAT day, not what the document says now.
 *
 * 2. It uses the request's own WORD. A request whose intent is `acknowledge`
 *    never says "sign", and the button never offers to upgrade what the signer
 *    is doing: acknowledging a handbook and signing an offer carry different
 *    evidentiary weight, and a page that blurs them produces a record nobody can
 *    rely on later.
 *
 * 3. It says when it is NOT the signer's turn, rather than showing a control
 *    that would fail. Countersignature is a real requirement, and "sign" that
 *    409s is worse than "waiting for the other party".
 *
 * DECLINING IS A FIRST-CLASS ANSWER, presented beside agreeing rather than
 * hidden. A page with only an agree button is not asking a question.
 */

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { signAsParty, signerView, type SignerView } from '@/lib/founderOpsApi';
import styles from './SignerConsole.module.css';

type State =
  | { status: 'loading' }
  | { status: 'ready'; view: SignerView }
  | { status: 'missing' };

export function SignerConsole({ token }: { token: string }) {
  const t = useTranslations('signDocument');
  const [state, setState] = useState<State>({ status: 'loading' });
  const [typedName, setTypedName] = useState('');
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settled, setSettled] = useState<'agreed' | 'declined' | null>(null);

  useEffect(() => {
    let cancelled = false;
    signerView(token)
      .then((view) => { if (!cancelled) setState({ status: 'ready', view }); })
      .catch(() => { if (!cancelled) setState({ status: 'missing' }); });
    return () => { cancelled = true; };
  }, [token]);

  if (state.status === 'loading') {
    return <main className={styles.page}><div className={styles.sheet}><p className={styles.notice}>{t('loading')}</p></div></main>;
  }
  if (state.status === 'missing') {
    return <main className={styles.page} role="alert"><div className={styles.sheet}><p className={styles.notice}>{t('invalid')}</p></div></main>;
  }

  const view = state.view;
  // The request's own word, resolved ONCE and used everywhere below — a page that
  // computed it per control is a page where one control eventually says the
  // other thing.
  const verb = view.intent === 'acknowledge' ? t('verbAcknowledge') : t('verbSign');
  const expired = view.expiresAt != null && new Date(view.expiresAt).getTime() <= Date.now();
  const alreadyDecided = view.status === 'signed' || view.status === 'acknowledged' || view.status === 'declined';

  const decide = async (decision: 'agree' | 'decline') => {
    setError(null);
    if (decision === 'agree' && !typedName.trim()) { setError(t('typeYourName')); return; }
    setBusy(true);
    try {
      await signAsParty(token, {
        decision,
        ...(decision === 'agree' ? { signedName: typedName.trim() } : { declineReason: reason.trim() }),
      });
      setSettled(decision === 'agree' ? 'agreed' : 'declined');
    } catch (decideError) {
      setError(decideError instanceof Error ? decideError.message : t('failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className={styles.page}>
      <div className={styles.sheet}>
        <p className={styles.eyebrow}>{view.subject}</p>
        <h1 className={styles.title}>{view.documentTitle}</h1>
        <p className={styles.addressed}>{t('addressedTo', { name: view.signerName })}</p>

        {/* The terms, as they were when this person was asked. `white-space:
            pre-wrap` and no markup interpretation: a document is not a place to
            render whatever HTML the body happens to contain. */}
        <article className={styles.document}>{view.documentBody}</article>

        {settled ? (
          <p className={styles.result} role="status">
            {settled === 'agreed'
              ? t('recordedAgreed', { verb })
              : t('recordedDeclined')}
          </p>
        ) : alreadyDecided ? (
          <p className={styles.notice} role="status">{t('alreadyDecided')}</p>
        ) : expired ? (
          <p className={styles.notice} role="alert">{t('expired')}</p>
        ) : view.requestStatus !== 'sent' ? (
          <p className={styles.notice} role="alert">{t('noLongerOpen', { status: view.requestStatus })}</p>
        ) : view.waitingOnOthers ? (
          // Said, rather than shown as a control that would be refused.
          <p className={styles.notice} role="status">{t('waitingOnOthers', { verb })}</p>
        ) : declining ? (
          <div className={styles.panel}>
            <label className={styles.label} htmlFor="decline-reason">{t('declineReason')}</label>
            <textarea
              id="decline-reason"
              className={styles.textarea}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={t('declineReasonHint')}
            />
            <div className={styles.actions}>
              <button type="button" className={styles.danger} disabled={busy} onClick={() => void decide('decline')}>
                {busy ? t('working') : t('confirmDecline')}
              </button>
              <button type="button" className={styles.ghost} disabled={busy} onClick={() => setDeclining(false)}>
                {t('back')}
              </button>
            </div>
          </div>
        ) : (
          <div className={styles.panel}>
            <label className={styles.label} htmlFor="typed-name">{t('typedNameLabel', { verb })}</label>
            <input
              id="typed-name"
              className={styles.input}
              value={typedName}
              onChange={(event) => setTypedName(event.target.value)}
              autoComplete="name"
              placeholder={view.signerName}
            />
            <p className={styles.help}>{t('typedNameHelp')}</p>
            <div className={styles.actions}>
              <button type="button" className={styles.primary} disabled={busy} onClick={() => void decide('agree')}>
                {busy ? t('working') : t('agree', { verb })}
              </button>
              {/* Beside the agree button, not hidden behind it. */}
              <button type="button" className={styles.ghost} disabled={busy} onClick={() => setDeclining(true)}>
                {t('decline')}
              </button>
            </div>
          </div>
        )}

        {error && <p className={styles.error} role="alert">{error}</p>}
      </div>
    </main>
  );
}
