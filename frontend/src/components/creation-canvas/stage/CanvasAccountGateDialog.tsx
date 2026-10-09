import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import { GuestSignupCta } from '@/components/GuestSignupCta';
import { trackActivity } from '@/lib/activity/tracker';
import { canvasNavigate, canvasSurface } from '@/lib/canvasHost';
import { claimLocalDraft } from '@/lib/pendingWork';
import { faultText } from '@/lib/apiClient';
import type { AccountGate } from '../canvasBoardTypes';
import { useCanvasSessionFacts } from '../chrome/canvasSessionContext';
import styles from '../CreationCanvas.module.css';
import { canvasLensSessionPath } from '@/lib/canvasLens';

export interface CanvasAccountGateDialogProps {
  gate: AccountGate | null;
  onClose: () => void;
  /** Signed in already — what is missing is a SAVED session, not an account. */
  hasAccount: boolean;
  claimingDraft: boolean;
  setClaimingDraft: (claiming: boolean) => void;
}

/**
 * THE GATE ASKS FOR WHAT IS ACTUALLY MISSING. Every caller writes signup-framed
 * copy because `persistence === 'local'` was read as "no account" — so a
 * signed-in user on an unsaved board was told to create the account they were
 * already using, and the only button offered took them to /register. What they
 * are actually missing is a SAVED SESSION for the action to point at, and
 * `claimLocalDraft` already turns this board into one. One branch here rather
 * than eight rewritten call sites: the callers say which action needs it, the
 * gate decides how to ask.
 */
export function CanvasAccountGateDialog({ gate, onClose, hasAccount, claimingDraft, setClaimingDraft }: CanvasAccountGateDialogProps) {
  const t = useTranslations('creationCanvas');
  const { sessionId, notify, lens, boardPath } = useCanvasSessionFacts();
  if (!gate) return null;
  return <div className={styles.accountGateBackdrop} role="presentation">
        <section className={styles.accountGate} role="dialog" aria-modal="true" aria-labelledby="canvas-account-gate-title">
          <button type="button" className={styles.accountGateClose} aria-label={t('closeAccountPrompt')} onClick={onClose}>×</button>
          <span className={styles.accountGateIcon} aria-hidden><Icon name="sparkles" size={20} /></span>
          <small>{t('keepMomentum')}</small>
          <h2 id="canvas-account-gate-title">{hasAccount ? t('gateSignedInTitle') : gate.title}</h2>
          <p>{hasAccount ? t('gateSignedInBody', { action: gate.action }) : gate.description}</p>
          <div className={styles.accountGateBenefits}><span>{`✓ ${t('gateBenefitKeep')}`}</span><span>{`✓ ${t('gateBenefitUnlock')}`}</span><span>{`✓ ${t('gateBenefitCollaborate')}`}</span></div>
          {hasAccount ? (
            <div className={styles.accountGateActions}>
              <button type="button" className={styles.primaryButton} disabled={claimingDraft} onClick={() => {
                trackActivity('creation_account_gate_accepted', { sessionId, metadata: { clientSurface: canvasSurface(), action: gate.action } });
                setClaimingDraft(true);
                void claimLocalDraft(sessionId)
                  // The saved board opens through the lens it was being seen through (Studio stays Studio).
                  .then((claimed) => { if (claimed) canvasNavigate(canvasLensSessionPath(lens, claimed.sessionId)); else notify(t('noticeSaveToAccountFailed')); })
                  .catch((error) => notify(faultText(error, t('noticeSaveToAccountFailed'))))
                  .finally(() => { setClaimingDraft(false); onClose(); });
              }}>{claimingDraft ? t('noticeSavingToAccount') : t('gateSaveToAccount')}</button>
            </div>
          ) : (
            // The SAME pair of buttons the Brain surface offers a guest who ran out
            // of free turns — one component, so the two never drift on wording or
            // on carrying this canvas through sign-up.
            <GuestSignupCta
              layout="actions"
              prompt={{
                next: boardPath,
                onAccept: () => trackActivity('creation_account_gate_accepted', { sessionId, metadata: { clientSurface: canvasSurface(), action: gate.action } }),
              }}
            />
          )}
          <button type="button" className={styles.accountGateLater} onClick={onClose}>{t('notNowKeepLocal')}</button>
        </section>
      </div>;
}
