'use client';

/**
 * FeedbackTab — the app's own feedback collector, dogfooding the embeddable
 * widget the snippet ships to customers.
 *
 * A small tab docked to the right edge; clicking it opens the canonical
 * SlideOutPanel with the submission form. It mounts once in the app shell and
 * decides its own visibility (the DRY rule: no parent passes it a `canShow`
 * boolean it could work out itself) — it renders nothing for signed-out
 * visitors, freelancer accounts, or when no project is in scope, because a
 * request has to land in SOME project's backlog.
 *
 * Every submission opens a ticket marked as an external request, which no agent
 * may execute until a human approves it in triage.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { Select } from '@/components/Select';
import { useAuth } from '@/lib/AuthContext';
import { useOptionalProjectScope } from '@/lib/ProjectScopeContext';
import { feedbackApi, FEEDBACK_KINDS, type FeedbackKind } from '@/lib/feedbackApi';

/** Routes that own the full viewport — the tab would collide with their chrome. */
const HIDDEN_PREFIXES = ['/embed', '/login', '/register', '/onboarding'];

const input: React.CSSProperties = {
  padding: '9px 12px', fontSize: 13, borderRadius: 8, width: '100%', boxSizing: 'border-box',
  border: '1px solid var(--border-subtle)', background: 'var(--bg-deep)', color: 'var(--text-primary)',
};
const label: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 6,
  fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)',
};

export function FeedbackTab() {
  const t = useTranslations('feedback');
  const pathname = usePathname() ?? '';
  const { isAuthenticated, hasTenant } = useAuth();
  const scope = useOptionalProjectScope();

  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<FeedbackKind>('feature');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A submission must land in a concrete project's backlog. At "All projects"
  // scope we fall back to the first project the user can see rather than hiding
  // the tab, so feedback is never blocked by the TopBar filter being cleared.
  const projectId = scope?.currentProjectId ?? scope?.projects[0]?.id ?? null;
  const projectName = scope?.projects.find((p) => p.id === projectId)?.name ?? null;

  if (!isAuthenticated || !hasTenant || projectId == null) return null;
  if (HIDDEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return null;

  const reset = () => { setKind('feature'); setTitle(''); setBody(''); setError(null); setDone(false); };
  const close = () => { setOpen(false); reset(); };

  const submit = async () => {
    if (!body.trim()) { setError(t('form.errorRequired')); return; }
    setSending(true); setError(null);
    try {
      await feedbackApi.submit({
        projectId,
        kind,
        title: title.trim() || undefined,
        body: body.trim(),
      });
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('form.errorGeneric'));
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="feedback-edge-tab"
        title={t('tab.tooltip')}
      >
        {t('tab.label')}
      </button>
      <style>{`
        /* A slim vertical tab on the right edge. Vertically centred, which keeps
           it clear of the bottom-right Brain launcher (56px + 20px inset) and,
           on mobile, of the 56px bottom nav. Sits at 9989 — below the Brain
           launcher (9990) and well below the SlideOutPanel overlay (9998). */
        .feedback-edge-tab {
          position: fixed;
          right: 0;
          top: 50%;
          transform: translateY(-50%);
          z-index: 9989;
          writing-mode: vertical-rl;
          padding: 16px 7px;
          border: 1px solid var(--border-subtle, #2c313a);
          border-right: none;
          border-radius: 8px 0 0 8px;
          cursor: pointer;
          background: var(--bg-elevated, #1d222a);
          color: var(--text-secondary, #98a2b3);
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.04em;
          box-shadow: -2px 0 12px rgba(0, 0, 0, 0.18);
          transition: color 0.15s ease, background 0.15s ease;
        }
        .feedback-edge-tab:hover {
          background: var(--coral-bright, #f4726e);
          color: #fff;
          border-color: var(--coral-bright, #f4726e);
        }
        .feedback-edge-tab:focus-visible {
          outline: 2px solid var(--coral-bright, #f4726e);
          outline-offset: 2px;
        }
        @media (max-width: 640px) {
          .feedback-edge-tab { padding: 12px 6px; font-size: 11px; }
        }
      `}</style>

      <SlideOutPanel open={open} onClose={close} title={t('form.title')} width="min(460px, 96vw)">
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {done ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>{t('form.successTitle')}</div>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>{t('form.successBody')}</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={reset}
                  style={{
                    padding: '9px 14px', fontSize: 13, fontWeight: 600, borderRadius: 8, cursor: 'pointer',
                    background: 'var(--coral-bright)', color: '#fff', border: 'none',
                  }}
                >
                  {t('form.another')}
                </button>
                <button
                  type="button"
                  onClick={close}
                  style={{
                    padding: '9px 14px', fontSize: 13, fontWeight: 600, borderRadius: 8, cursor: 'pointer',
                    background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)',
                  }}
                >
                  {t('form.close')}
                </button>
              </div>
            </div>
          ) : (
            <>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>{t('form.intro')}</p>
              {projectName && (
                <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
                  {t('form.destination', { project: projectName })}
                </p>
              )}

              <label style={label}>
                {t('form.kind')}
                <Select value={kind} onChange={(e) => setKind(e.target.value as FeedbackKind)} style={input}>
                  {FEEDBACK_KINDS.map((k) => <option key={k} value={k}>{t(`kind.${k}`)}</option>)}
                </Select>
              </label>

              <label style={label}>
                {t('form.summary')}
                <input
                  type="text"
                  maxLength={300}
                  style={input}
                  placeholder={t('form.summaryPlaceholder')}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>

              <label style={label}>
                {t('form.details')}
                <textarea
                  maxLength={10000}
                  style={{ ...input, minHeight: 150, resize: 'vertical', fontFamily: 'inherit' }}
                  placeholder={t('form.detailsPlaceholder')}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                />
              </label>

              {error && <div role="alert" style={{ fontSize: 13, color: 'var(--danger, #dc2626)' }}>{error}</div>}

              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('form.gateNote')}</div>

              <button
                type="button"
                onClick={submit}
                disabled={sending}
                style={{
                  padding: '11px 16px', fontSize: 14, fontWeight: 600, borderRadius: 8,
                  background: 'var(--coral-bright)', color: '#fff', border: 'none',
                  cursor: sending ? 'default' : 'pointer', opacity: sending ? 0.6 : 1,
                }}
              >
                {sending ? t('form.submitting') : t('form.submit')}
              </button>
            </>
          )}
        </div>
      </SlideOutPanel>
    </>
  );
}
