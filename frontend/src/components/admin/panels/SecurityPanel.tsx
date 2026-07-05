'use client';

/**
 * Platform Admin ▸ Security panel.
 *
 * Self-fetching tab body extracted from the monolithic admin page. Lets a
 * superadmin pick a workspace + user and manage their MFA, sessions and JWT
 * tokens. The inline banner (via <AdminError/>) doubles as a status line — the
 * "Scan QR…" MFA-setup instruction is shown there too, exactly as the source did
 * with setErrorMsg.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  adminApi,
  type AdminTenant,
  type AdminSecurityUser,
  type AdminSecurityDetails,
} from '@/lib/adminApi';
import { Select } from '@/components/Select';
import { AdminError, errText, fmtDateTime } from '../adminShared';

export default function SecurityPanel() {
  const [tenants, setTenants] = useState<AdminTenant[]>([]);
  const [securityTenantId, setSecurityTenantId] = useState<number | null>(null);
  const [securityUsers, setSecurityUsers] = useState<AdminSecurityUser[]>([]);
  const [securityUserId, setSecurityUserId] = useState<string | null>(null);
  const [securityDetails, setSecurityDetails] = useState<AdminSecurityDetails | null>(null);

  const [securityMfaCode, setSecurityMfaCode] = useState('');
  const [securityRecoveryCode, setSecurityRecoveryCode] = useState('');
  const [securityMfaMode, setSecurityMfaMode] = useState<'totp' | 'recovery'>('totp');
  const [securityMfaManualKey, setSecurityMfaManualKey] = useState('');
  const [securityRecoveryCodes, setSecurityRecoveryCodes] = useState<string[]>([]);

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  const reload = useCallback(() => {
    setLoading(true);
    setErrorMsg('');
    (async () => {
      const tenantsData = await adminApi.tenants();
      setTenants(tenantsData);
      const tid = securityTenantId ?? tenantsData[0]?.id ?? null;
      if (tid && !tenantsData.find((x) => x.id === tid)) setSecurityTenantId(tenantsData[0]?.id ?? null);
      else if (tid !== securityTenantId) setSecurityTenantId(tid);
      if (tid) {
        const usersData = await adminApi.securityUsers(tid);
        setSecurityUsers(usersData);
        if (securityUserId) {
          const details = await adminApi.securityDetails(tid, securityUserId);
          setSecurityDetails(details);
        } else setSecurityDetails(null);
      } else setSecurityUsers([]);
    })()
      .catch((e) => setErrorMsg(errText(e)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const handleSecurityTenantChange = (tid: number | null) => {
    setSecurityTenantId(tid);
    setSecurityUserId(null);
    setSecurityDetails(null);
    if (!tid) {
      setSecurityUsers([]);
      return;
    }
    setLoading(true);
    setErrorMsg('');
    adminApi
      .securityUsers(tid)
      .then(setSecurityUsers)
      .catch((e) => setErrorMsg(errText(e)))
      .finally(() => setLoading(false));
  };

  const handleSecurityUserSelect = (uid: string | null) => {
    setSecurityUserId(uid);
    if (!uid || !securityTenantId) {
      setSecurityDetails(null);
      return;
    }
    setLoading(true);
    adminApi
      .securityDetails(securityTenantId, uid)
      .then(setSecurityDetails)
      .catch((e) => setErrorMsg(errText(e)))
      .finally(() => setLoading(false));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <AdminError message={errorMsg} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <label className="text-muted" style={{ fontSize: 14 }}>Workspace</label>
        <Select
          className="admin-select"
          value={securityTenantId ?? ''}
          onChange={(e) => handleSecurityTenantChange(Number(e.target.value) || null)}
        >
          <option value="">Select…</option>
          {tenants.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </Select>
        {securityTenantId && (
          <>
            <label className="text-muted" style={{ fontSize: 14 }}>User</label>
            <Select
              className="admin-select"
              value={securityUserId ?? ''}
              onChange={(e) => handleSecurityUserSelect(e.target.value || null)}
              style={{ minWidth: 200 }}
            >
              <option value="">Select user…</option>
              {securityUsers.map((u) => (
                <option key={u.id} value={u.id}>{u.email}</option>
              ))}
            </Select>
          </>
        )}
        <button type="button" className="btn-ghost" onClick={reload} disabled={loading}>↻ Refresh</button>
      </div>
      {securityTenantId && (
        <>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>MFA</th>
                  <th>Sessions</th>
                  <th>Tokens</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {securityUsers.map((u) => (
                  <tr key={u.id}>
                    <td>{u.email}</td>
                    <td>{u.mfaEnabled ? '✓' : '—'}</td>
                    <td>{u.activeSessions}</td>
                    <td>{u.activeTokens}</td>
                    <td>
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={() => handleSecurityUserSelect(securityUserId === u.id ? null : u.id)}
                      >
                        {securityUserId === u.id ? 'Hide details' : 'Details'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {securityDetails && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="health-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 140px), 1fr))' }}>
                <div className="health-card" style={{ padding: 12 }}>
                  <div className="health-label">User</div>
                  <div style={{ fontSize: 14 }}>{securityDetails.user.email}</div>
                </div>
                <div className="health-card" style={{ padding: 12 }}>
                  <div className="health-label">MFA</div>
                  <div style={{ fontSize: 14 }}>{securityDetails.mfa.enabled ? 'Enabled' : 'Off'}</div>
                </div>
                <div className="health-card" style={{ padding: 12 }}>
                  <div className="health-label">Active sessions</div>
                  <div className="health-value">{securityDetails.sessions.length}</div>
                </div>
                <div className="health-card" style={{ padding: 12 }}>
                  <div className="health-label">Active tokens</div>
                  <div className="health-value">{securityDetails.tokens.length}</div>
                </div>
              </div>
              <div className="health-card" style={{ padding: 16 }}>
                <div className="health-label" style={{ marginBottom: 12 }}>MFA</div>
                {!securityDetails.mfa.enabled && !securityDetails.mfa.setupPending && (
                  <button
                    type="button"
                    className="admin-tab"
                    onClick={async () => {
                      setErrorMsg('');
                      try {
                        const r = await adminApi.securityMfaSetup(securityTenantId!, securityUserId!);
                        setSecurityMfaManualKey(r.manualEntryKey ?? '');
                        window.open(r.otpauthUrl);
                        setErrorMsg('Scan QR in the opened tab (or use manual key below). Enter 6-digit code and click Enable MFA.');
                        handleSecurityUserSelect(securityUserId);
                      } catch (e) {
                        setErrorMsg(e instanceof Error ? e.message : String(e));
                      }
                    }}
                  >
                    Set up MFA
                  </button>
                )}
                {!securityDetails.mfa.enabled && securityDetails.mfa.setupPending && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {securityMfaManualKey && (
                      <div style={{ fontSize: 12 }}>
                        <span className="text-muted">Manual entry key: </span>
                        <code style={{ background: 'var(--bg-elevated)', padding: '2px 6px', borderRadius: 4 }}>{securityMfaManualKey}</code>
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <input
                        type="text"
                        placeholder="6-digit code"
                        value={securityMfaCode}
                        onChange={(e) => setSecurityMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        className="admin-select"
                        style={{ width: 120 }}
                      />
                      <button
                        type="button"
                        className="admin-tab active"
                        disabled={securityMfaCode.length !== 6}
                        onClick={async () => {
                          setErrorMsg('');
                          try {
                            const r = await adminApi.securityMfaEnable(securityTenantId!, securityUserId!, securityMfaCode);
                            setSecurityRecoveryCodes(r.recoveryCodes ?? []);
                            setSecurityMfaCode('');
                            setSecurityMfaManualKey('');
                            setErrorMsg('');
                            handleSecurityUserSelect(securityUserId);
                          } catch (e) {
                            setErrorMsg(e instanceof Error ? e.message : String(e));
                          }
                        }}
                      >
                        Enable MFA
                      </button>
                    </div>
                  </div>
                )}
                {securityDetails.mfa.enabled && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <label className="text-muted" style={{ fontSize: 12 }}>Disable with:</label>
                      <Select
                        className="admin-select"
                        value={securityMfaMode}
                        onChange={(e) => setSecurityMfaMode(e.target.value as 'totp' | 'recovery')}
                        style={{ width: 100 }}
                      >
                        <option value="totp">TOTP code</option>
                        <option value="recovery">Recovery code</option>
                      </Select>
                      <input
                        type="text"
                        placeholder={securityMfaMode === 'totp' ? '6-digit code' : 'Recovery code'}
                        value={securityMfaMode === 'totp' ? securityMfaCode : securityRecoveryCode}
                        onChange={(e) =>
                          securityMfaMode === 'totp'
                            ? setSecurityMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))
                            : setSecurityRecoveryCode(e.target.value)
                        }
                        className="admin-select"
                        style={{ width: 160 }}
                      />
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={async () => {
                          setErrorMsg('');
                          try {
                            await adminApi.securityMfaDisable(securityTenantId!, securityUserId!, securityMfaMode === 'totp' ? { code: securityMfaCode } : { recoveryCode: securityRecoveryCode });
                            setSecurityMfaCode('');
                            setSecurityRecoveryCode('');
                            handleSecurityUserSelect(securityUserId);
                          } catch (e) {
                            setErrorMsg(e instanceof Error ? e.message : String(e));
                          }
                        }}
                      >
                        Disable MFA
                      </button>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span className="text-muted" style={{ fontSize: 12 }}>Regenerate recovery codes:</span>
                      <input
                        type="text"
                        placeholder={securityMfaMode === 'totp' ? '6-digit code' : 'Recovery code'}
                        value={securityMfaMode === 'totp' ? securityMfaCode : securityRecoveryCode}
                        onChange={(e) =>
                          securityMfaMode === 'totp'
                            ? setSecurityMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))
                            : setSecurityRecoveryCode(e.target.value)
                        }
                        className="admin-select"
                        style={{ width: 160 }}
                      />
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={async () => {
                          setErrorMsg('');
                          try {
                            const r = await adminApi.securityRegenerateRecoveryCodes(securityTenantId!, securityUserId!, securityMfaMode === 'totp' ? { code: securityMfaCode } : { recoveryCode: securityRecoveryCode });
                            setSecurityRecoveryCodes(r.recoveryCodes ?? []);
                            handleSecurityUserSelect(securityUserId);
                          } catch (e) {
                            setErrorMsg(e instanceof Error ? e.message : String(e));
                          }
                        }}
                      >
                        Regenerate
                      </button>
                    </div>
                    {securityRecoveryCodes.length > 0 && (
                      <div style={{ fontSize: 12 }}>
                        <div className="health-label">Recovery codes (save these)</div>
                        <pre style={{ background: 'var(--bg-elevated)', padding: 12, borderRadius: 8, overflow: 'auto' }}>{securityRecoveryCodes.join('\n')}</pre>
                        <button
                          type="button"
                          className="btn-ghost"
                          style={{ marginTop: 4 }}
                          onClick={() => {
                            const blob = new Blob([securityRecoveryCodes.join('\n')], { type: 'text/plain' });
                            const a = document.createElement('a');
                            a.href = URL.createObjectURL(blob);
                            a.download = `recovery-codes-${securityDetails.user.email}-${new Date().toISOString().slice(0, 10)}.txt`;
                            a.click();
                            URL.revokeObjectURL(a.href);
                          }}
                        >
                          Download recovery codes
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="health-card" style={{ padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <div className="health-label">Sessions</div>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={async () => {
                      setErrorMsg('');
                      try {
                        await adminApi.securityRevokeAllSessions(securityTenantId!, securityUserId!);
                        handleSecurityUserSelect(securityUserId);
                      } catch (e) {
                        setErrorMsg(e instanceof Error ? e.message : String(e));
                      }
                    }}
                  >
                    Revoke all sessions
                  </button>
                </div>
                <div className="table-wrap">
                  <table className="data-table" style={{ fontSize: 13 }}>
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>User agent</th>
                        <th>IP</th>
                        <th>Tokens</th>
                        <th>Last seen</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {securityDetails.sessions.filter((s) => s.isActive).map((s) => (
                        <tr key={s.id}>
                          <td>{s.sessionName ?? '—'}</td>
                          <td className="text-muted" style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }} title={s.userAgent ?? undefined}>{s.userAgent ?? '—'}</td>
                          <td className="text-muted">{s.ipAddress ?? '—'}</td>
                          <td>{s.activeTokens}</td>
                          <td className="text-muted">{s.lastSeenAt ? fmtDateTime(s.lastSeenAt) : '—'}</td>
                          <td>
                            <button
                              type="button"
                              className="btn-ghost"
                              onClick={async () => {
                                setErrorMsg('');
                                try {
                                  await adminApi.securityRevokeSession(securityTenantId!, securityUserId!, s.id);
                                  handleSecurityUserSelect(securityUserId);
                                } catch (e) {
                                  setErrorMsg(e instanceof Error ? e.message : String(e));
                                }
                              }}
                            >
                              Revoke
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="health-card" style={{ padding: 16 }}>
                <div className="health-label" style={{ marginBottom: 12 }}>JWT tokens</div>
                <div className="table-wrap">
                  <table className="data-table" style={{ fontSize: 13 }}>
                    <thead>
                      <tr>
                        <th>jti</th>
                        <th>Type</th>
                        <th>Tenant</th>
                        <th>Expires</th>
                        <th>Active</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {securityDetails.tokens.filter((t) => t.isActive).map((tok) => (
                        <tr key={tok.jti}>
                          <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{tok.jti.slice(0, 12)}…</td>
                          <td>{tok.tokenType}</td>
                          <td className="text-muted">{tok.tenantId ?? '—'}</td>
                          <td className="text-muted">{fmtDateTime(tok.expiresAt)}</td>
                          <td>{tok.isActive ? '✓' : '—'}</td>
                          <td>
                            <button
                              type="button"
                              className="btn-ghost"
                              onClick={async () => {
                                setErrorMsg('');
                                try {
                                  await adminApi.securityRevokeToken(securityTenantId!, securityUserId!, tok.jti);
                                  handleSecurityUserSelect(securityUserId);
                                } catch (e) {
                                  setErrorMsg(e instanceof Error ? e.message : String(e));
                                }
                              }}
                            >
                              Revoke
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
