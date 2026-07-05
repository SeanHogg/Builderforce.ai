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
      .catch(() => setError('Failed to load user workspaces'))
      .finally(() => setWorkspacesLoading(false));
  }, []);

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
            <h3 id="emulate-title" className="page-title" style={{ marginBottom: 4 }}>Emulate User</h3>
            <p className="page-sub" style={{ marginBottom: 16 }}>
              Start an emulation session as <strong>{target.email}</strong> using their default workspace and assigned role.
              You will be taken to the dashboard with an amber emulation bar.
            </p>

            {error && (
              <p className="text-muted" style={{ fontSize: 13, marginBottom: 14, color: 'var(--error-text)' }}>{error}</p>
            )}

            {workspacesLoading ? (
              <p className="text-muted" style={{ fontSize: 13, marginBottom: 14 }}>Loading workspace…</p>
            ) : workspaces.length === 0 ? (
              <p className="text-muted" style={{ fontSize: 13, marginBottom: 14, color: 'var(--error-text)' }}>
                This user has no active workspaces.
              </p>
            ) : (
              <div style={{ marginBottom: 14, padding: '8px 12px', background: 'var(--surface-alt, #1e1e2e)', borderRadius: 6, fontSize: 13 }}>
                <span style={{ opacity: 0.6, marginRight: 8 }}>Workspace:</span>
                <strong>{workspaces[0]!.name}</strong>
                <span style={{ opacity: 0.5, margin: '0 8px' }}>·</span>
                <span style={{ opacity: 0.6, marginRight: 8 }}>Role:</span>
                <strong>{workspaces[0]!.role}</strong>
              </div>
            )}

            <label className="admin-label" style={{ display: 'block', marginBottom: 4 }}>
              Reason <span style={{ color: 'var(--error-text)' }}>*</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="admin-token-textarea"
              placeholder="Brief reason for this emulation session (required)…"
              style={{ minHeight: 72, marginBottom: 14 }}
            />

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, cursor: 'pointer', fontSize: 13 }}>
              <input
                type="checkbox"
                checked={debuggerEnabled}
                onChange={(e) => setDebuggerEnabled(e.target.checked)}
              />
              Enable permission debugger overlay
            </label>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="admin-tab" onClick={close} disabled={busy}>Cancel</button>
              <button
                type="button"
                className="admin-tab active"
                onClick={confirm}
                disabled={workspaces.length === 0 || !reason.trim() || busy}
              >
                {busy ? 'Starting…' : 'Start Emulation'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}
