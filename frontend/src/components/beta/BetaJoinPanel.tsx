'use client';

/**
 * Step 3 of the beta flow: what you are joining, and agreeing to join it.
 *
 * The banner interrupts, this panel explains and takes consent — never the other
 * way round. Joining is DISABLED until the person ticks the agreement, and the
 * server enforces the same thing, so a client that skips the box still cannot
 * enrol anyone.
 *
 * A slide-out, not a modal: the app reserves centered modals for terminal
 * destructive approvals, and leaving a beta is reversible — you can rejoin from
 * the same panel.
 */

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import LegalDocModal, { type LegalDocType } from '@/components/legal/LegalDocModal';
import { useLegalDocs } from '@/components/legal/useLegalDocs';
import {
  ReleaseNoteBody,
  StageBadge,
  useReleaseNoteDate,
} from '@/components/releaseNotes/ReleaseNoteParts';
import { useBetaPrograms } from '@/lib/betaPrograms';
import type { BetaProgram } from '@/lib/releaseNotesApi';

const sectionTitle: React.CSSProperties = {
  margin: '0 0 6px',
  fontSize: 'var(--font-size-card-title)',
  fontWeight: 700,
  color: 'var(--text-primary)',
};

/** Default drawer layer, matching SlideOutPanel's own default. */
const BASE_Z = 9998;

export default function BetaJoinPanel({
  beta,
  open,
  onClose,
  zIndex = BASE_Z,
}: {
  beta: BetaProgram | null;
  open: boolean;
  onClose: () => void;
  /** Raise it when this panel is opened FROM another panel — the changelog opens
   *  it over itself, and equal layers would leave the stacking to DOM order. */
  zIndex?: number;
}) {
  const t = useTranslations('beta');
  // The document's own name, from the namespace that owns it — the reader here
  // and the footer link must never drift into two different words for it.
  const tLegal = useTranslations('legal');
  const fmtDate = useReleaseNoteDate();
  const { act } = useBetaPrograms();
  const { legal } = useLegalDocs();

  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [legalDoc, setLegalDoc] = useState<LegalDocType | null>(null);

  // Consent is per opening: reopening the panel — or opening it for a different
  // beta — must never arrive with the box already ticked.
  useEffect(() => {
    if (open) {
      setAgreed(false);
      setError(false);
    }
  }, [open, beta?.id]);

  if (!beta) return null;

  const joined = beta.myStatus === 'joined';
  const terms = beta.betaTerms?.trim() || t('defaultTerms');

  const run = async (action: 'join' | 'leave' | 'dismiss') => {
    setBusy(true);
    setError(false);
    try {
      await act(beta.id, action, action === 'join');
      onClose();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SlideOutPanel
        open={open}
        onClose={onClose}
        width="wide"
        crumb={t('crumb')}
        title={beta.title}
        zIndex={zIndex}
      >
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Where this update stands: stage, version, when it last moved. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <StageBadge stage={beta.stage} />
            <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono, monospace)' }}>
              v{beta.version}
            </span>
            <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>
              {t('lastUpdated', { date: fmtDate(beta.updatedAt) })}
            </span>
          </div>

          {joined && (
            <div
              role="status"
              style={{
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--success)',
                background: 'var(--success-bg)',
                color: 'var(--success-text)',
                padding: '10px 12px',
                fontSize: 'var(--font-size-small)',
              }}
            >
              {beta.agreedAt ? t('joinedOn', { date: fmtDate(beta.agreedAt) }) : t('joinedAlready')}
            </div>
          )}

          <section>
            <h3 style={sectionTitle}>{t('whatIsIt')}</h3>
            <ReleaseNoteBody body={beta.body} />
            {beta.stageEndsAt && (
              <p style={{ margin: '4px 0 0', fontSize: 'var(--font-size-body)', color: 'var(--text-secondary)' }}>
                {t('rollsOut', { date: fmtDate(beta.stageEndsAt) })}
              </p>
            )}
          </section>

          <section>
            <h3 style={sectionTitle}>{t('termsTitle')}</h3>
            <div
              style={{
                maxHeight: 220,
                overflowY: 'auto',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--surface-sunken)',
                padding: 12,
                fontSize: 'var(--font-size-small)',
                lineHeight: 1.6,
                color: 'var(--text-secondary)',
                whiteSpace: 'pre-wrap',
              }}
            >
              {terms}
            </div>
          </section>

          {/* The gate. Everything below is inert until this is ticked — and the
              server re-checks it, so the box is a UI for consent, not the proof. */}
          {!joined && (
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 'var(--font-size-small)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                style={{ marginTop: 2, width: 16, height: 16, flexShrink: 0, accentColor: 'var(--coral-bright)' }}
              />
              <span style={{ color: 'var(--text-secondary)' }}>
                {t('agreeLabel')}{' '}
                <button
                  type="button"
                  onClick={() => setLegalDoc('terms')}
                  style={{
                    border: 'none',
                    background: 'none',
                    padding: 0,
                    color: 'var(--coral-bright)',
                    textDecoration: 'underline',
                    cursor: 'pointer',
                    font: 'inherit',
                  }}
                >
                  {tLegal('termsTitle')}
                </button>
              </span>
            </label>
          )}

          {error && (
            <p role="alert" style={{ margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--danger)' }}>
              {t('actionFailed')}
            </p>
          )}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {joined ? (
              <button type="button" className="btn-secondary" disabled={busy} onClick={() => run('leave')}>
                {busy ? t('working') : t('leave')}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={busy || !agreed}
                  onClick={() => run('join')}
                >
                  {busy ? t('working') : t('join')}
                </button>
                <button type="button" className="btn-ghost" disabled={busy} onClick={() => run('dismiss')}>
                  {t('notNow')}
                </button>
              </>
            )}
          </div>
        </div>
      </SlideOutPanel>

      {/* The platform Terms of Use, read from the same source as the footer, and
          stacked above this panel rather than behind the drawer that opened it. */}
      <LegalDocModal type={legalDoc} legal={legal} onClose={() => setLegalDoc(null)} zIndex={zIndex + 10} />
    </>
  );
}
