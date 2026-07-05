'use client';

/**
 * Emulate ("impersonate") launcher — a self-contained cross-cutting concern.
 *
 * Two admin panels (Users, Tenants) plus the User Detail drawer all need to open
 * the emulate flow, so rather than prop-drill a `startImpersonate` callback + its
 * modal state through each of them, this provider owns the flow ONCE: it renders
 * the modal and exposes `startEmulation(user)` via context. Any descendant calls
 * `useEmulationLauncher().startEmulation(u)` — the shared component decides its
 * own visibility and behaviour.
 */

import React, { createContext, useCallback, useContext, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEmulation } from '@/lib/EmulationContext';
import { adminApi, type AdminUser, type UserWorkspace } from '@/lib/adminApi';
import { errText } from './adminShared';

interface EmulationLauncherValue {
  /** Open the emulate modal targeting `user`. */
  startEmulation: (user: AdminUser) => void;
}

const Ctx = createContext<EmulationLauncherValue | null>(null);

export function useEmulationLauncher(): EmulationLauncherValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useEmulationLauncher must be used within <EmulationLauncherProvider>');
  return ctx;
}

export function EmulationLauncherProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const t = useTranslations('admin');
  const { startEmulation: beginSession } = useEmulation();

  const [target, setTarget] = useState<AdminUser | null>(null);
  const [workspaces, setWorkspaces] = useState<UserWorkspace[]>([]);
  const [workspacesLoading, setWorkspacesLoading] = useState(false);
  const [reason, setReason] = useState('');
  const [debuggerEnabled, setDebuggerEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const startEmulation = useCallback((user: AdminUser) => {
    setTarget(user);
    setWorkspaces([]);
    setReason('');
    setDebuggerEnabled(false);
    setError('');
    setWorkspacesLoading(true);
    adminApi.userWorkspaces(user.id)
      .then(setWorkspaces)
      .catch(() => setError(t('emulate.loadWorkspacesFailed')))
      .finally(() => setWorkspacesLoading(false));
  }, [t]);

  const close = useCallback(() => {
    setTarget(null);
    setWorkspaces([]);
    setReason('');
    setDebuggerEnabled(false);
    setError('');
  }, []);

  const confirm = useCallback(async () => {
    const workspace = workspaces[0];
    if (!target || !workspace || !reason.trim()) return;
    setBusy(true);
    setError('');
    try {
      const res = await adminApi.impersonationStart(target.id, workspace.tenantId, reason.trim(), debuggerEnabled);
      beginSession(res.session, res.emulationToken);
      close();
      router.push('/dashboard');
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }, [workspaces, target, reason, debuggerEnabled, beginSession, close, router]);

  return (
    <Ctx.Provider value={{ startEmulation }}>
      {children}
      {target && (
        <div
          className="admin-modal-overlay"
          onClick={close}
          role="dialog"
          aria-modal="true"
          aria-labelledby="emulate-title"
        >
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <h3 id="emulate-title" className="page-title" style={{ marginBottom: 4 }}>{t('emulate.title')}</h3>
            <p className="page-sub" style={{ marginBottom: 16 }}>
              {t.rich('emulate.intro', { email: target.email, strong: (c) => <strong>{c}</strong> })}
            </p>

            {error && (
              <p className="text-muted" style={{ fontSize: 13, marginBottom: 14, color: 'var(--error-text)' }}>{error}</p>
            )}

            {workspacesLoading ? (
              <p className="text-muted" style={{ fontSize: 13, marginBottom: 14 }}>{t('emulate.loadingWorkspace')}</p>
            ) : workspaces.length === 0 ? (
              <p className="text-muted" style={{ fontSize: 13, marginBottom: 14, color: 'var(--error-text)' }}>
                {t('emulate.noWorkspaces')}
              </p>
            ) : (
              <div style={{ marginBottom: 14, padding: '8px 12px', background: 'var(--surface-alt, #1e1e2e)', borderRadius: 6, fontSize: 13 }}>
                <span style={{ opacity: 0.6, marginRight: 8 }}>{t('emulate.workspace')}</span>
                <strong>{workspaces[0]!.name}</strong>
                <span style={{ opacity: 0.5, margin: '0 8px' }}>·</span>
                <span style={{ opacity: 0.6, marginRight: 8 }}>{t('emulate.role')}</span>
                <strong>{workspaces[0]!.role}</strong>
              </div>
            )}

            <label className="admin-label" style={{ display: 'block', marginBottom: 4 }}>
              {t('emulate.reason')} <span style={{ color: 'var(--error-text)' }}>*</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="admin-token-textarea"
              placeholder={t('emulate.reasonPlaceholder')}
              style={{ minHeight: 72, marginBottom: 14 }}
            />

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, cursor: 'pointer', fontSize: 13 }}>
              <input
                type="checkbox"
                checked={debuggerEnabled}
                onChange={(e) => setDebuggerEnabled(e.target.checked)}
              />
              {t('emulate.debuggerOverlay')}
            </label>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="admin-tab" onClick={close} disabled={busy}>{t('common.cancel')}</button>
              <button
                type="button"
                className="admin-tab active"
                onClick={confirm}
                disabled={workspaces.length === 0 || !reason.trim() || busy}
              >
                {busy ? t('emulate.starting') : t('emulate.start')}
              </button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}
