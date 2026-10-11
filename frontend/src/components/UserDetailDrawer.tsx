import { useCallback, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Select } from '@/components/Select';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import {
  adminApi,
  type AdminUser,
  type AdminSecurityDetails,
  type EffectivePermissions,
  type ImpersonationSession,
} from '@/lib/adminApi';
import { useConfirm } from '@/components/ConfirmProvider';
import { useToast } from '@/components/ToastProvider';
import { InlineConfirmButton } from '@/components/InlineConfirmButton';
import { useFormat } from '@/i18n/useFormat';
import { useErrorText } from '@/i18n/useErrorMessage';
import {
  AdminAccessSection,
  MutedNote,
  PermissionsSection,
  ProfileSection,
  SecuritySection,
  SessionsSection,
  USER_DETAIL_TABS,
  isTenantScopedTab,
  type UserDetailTab,
} from '@/components/UserDetailSections';

interface Props {
  user: AdminUser;
  tenants: Array<{ id: number; name: string; slug: string }>;
  onClose: () => void;
  onStartImpersonate: (user: AdminUser) => void;
}

/**
 * Admin ▸ Users ▸ one user — a detail view, so it is a `SlideOutPanel` (§0.7),
 * not a hand-rolled overlay. This file owns the panel, the fetching and the
 * actions that change the user; `UserDetailSections` renders each tab.
 */
export default function UserDetailDrawer({ user, tenants, onClose, onStartImpersonate }: Props) {
  const errorText = useErrorText();
  const fmt = useFormat();
  const t = useTranslations('admin');
  const confirm = useConfirm();
  const toast = useToast();
  const [tab, setTab] = useState<UserDetailTab>('profile');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const [selectedTenantId, setSelectedTenantId] = useState<number | null>(tenants[0]?.id ?? null);
  const [secDetails, setSecDetails] = useState<AdminSecurityDetails | null>(null);
  const [effectivePerms, setEffectivePerms] = useState<EffectivePermissions | null>(null);
  const [adminAccess, setAdminAccess] = useState<ImpersonationSession[]>([]);

  const [forceLogoutBusy, setForceLogoutBusy] = useState(false);
  const [resetPwBusy, setResetPwBusy] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);

  /**
   * Switch to a tab and fetch what it shows. The workspace is a parameter rather
   * than read from state so a workspace change loads the workspace just picked,
   * not the one this callback closed over.
   */
  const loadTab = useCallback(
    async (next: UserDetailTab, tenantId: number | null = selectedTenantId) => {
      setTab(next);
      setErrorMsg('');
      if (next === 'profile') return;
      if (isTenantScopedTab(next) && !tenantId) return;
      setLoading(true);
      try {
        if (next === 'access') {
          const r = await adminApi.userAdminAccess(user.id);
          setAdminAccess(r.sessions);
        } else if (tenantId) {
          if (next === 'permissions') {
            setEffectivePerms(await adminApi.effectivePermissions(user.id, tenantId));
          } else {
            setSecDetails(await adminApi.securityDetails(tenantId, user.id));
          }
        }
      } catch (e) {
        setErrorMsg(errorText(e));
      } finally {
        setLoading(false);
      }
    },
    [user.id, selectedTenantId, errorText],
  );

  async function doForceLogout() {
    if (!(await confirm(t('users.drawer.confirmForceLogout', { email: user.email })))) return;
    setForceLogoutBusy(true);
    setErrorMsg('');
    try {
      await adminApi.forceLogout(user.id);
      toast.success(t('users.drawer.forceLogoutDone'));
    } catch (e) {
      setErrorMsg(errorText(e));
    } finally {
      setForceLogoutBusy(false);
    }
  }

  // Sends a sign-in link; the password is NOT changed and nobody is locked out, so
  // the deliberate second click is the inline two-step on the button, not a modal.
  async function doResetPassword() {
    setResetPwBusy(true);
    setErrorMsg('');
    try {
      await adminApi.resetPassword(user.id);
      toast.success(t('users.drawer.resetPasswordDone'));
    } catch (e) {
      setErrorMsg(errorText(e));
    } finally {
      setResetPwBusy(false);
    }
  }

  async function doSuspend(suspend: boolean) {
    const question = suspend
      ? t('users.drawer.confirmSuspend', { email: user.email })
      : t('users.drawer.confirmUnsuspend', { email: user.email });
    if (!(await confirm(question))) return;
    setStatusBusy(true);
    setErrorMsg('');
    try {
      await adminApi.setUserStatus(user.id, suspend);
      toast.success(suspend ? t('users.drawer.suspendDone') : t('users.drawer.unsuspendDone'));
    } catch (e) {
      setErrorMsg(errorText(e));
    } finally {
      setStatusBusy(false);
    }
  }

  async function doRevokeAllSessions(tenantId: number) {
    setLoading(true);
    setErrorMsg('');
    try {
      await adminApi.securityRevokeAllSessions(tenantId, user.id);
      setSecDetails(await adminApi.securityDetails(tenantId, user.id));
    } catch (e) {
      setErrorMsg(errorText(e));
    } finally {
      setLoading(false);
    }
  }

  const TAB_LABELS: Record<UserDetailTab, string> = {
    profile: t('users.drawer.tabProfile'),
    permissions: t('users.drawer.tabPermissions'),
    sessions: t('users.drawer.tabSessions'),
    security: t('users.drawer.tabSecurity'),
    access: t('users.drawer.tabAccess'),
  };

  const profileActions = (
    <>
      <button type="button" className="admin-tab" disabled={forceLogoutBusy} onClick={doForceLogout}>
        {forceLogoutBusy ? t('users.drawer.forceLogoutBusy') : t('users.drawer.forceLogout')}
      </button>
      <InlineConfirmButton
        className="admin-tab"
        disabled={resetPwBusy}
        onConfirm={doResetPassword}
        hint={t('users.drawer.confirmResetPassword', { email: user.email })}
      >
        {resetPwBusy ? t('users.drawer.resetPasswordBusy') : t('users.drawer.resetPassword')}
      </InlineConfirmButton>
      <button
        type="button"
        className="admin-tab"
        style={{ color: 'var(--error-text)' }}
        disabled={statusBusy}
        onClick={() => doSuspend(true)}
      >
        {statusBusy ? t('users.drawer.suspendBusy') : t('users.drawer.suspendAccount')}
      </button>
    </>
  );

  const note = (text: string) => (
    <div style={{ padding: 16 }}>
      <MutedNote>{text}</MutedNote>
    </div>
  );

  /** A workspace-scoped tab: ask for a workspace first, then say so when it returned nothing. */
  function tenantScoped(emptyText: string, section: ReactNode): ReactNode {
    if (!selectedTenantId) return note(t('users.drawer.selectWorkspaceAbove'));
    return section ?? note(emptyText);
  }

  function renderBody(): ReactNode {
    if (loading) return note(t('common.loading'));
    switch (tab) {
      case 'profile':
        return <ProfileSection user={user} fmt={fmt} actions={profileActions} />;
      case 'permissions':
        return tenantScoped(
          t('users.drawer.noPermissionData'),
          effectivePerms ? <PermissionsSection perms={effectivePerms} /> : null,
        );
      case 'sessions':
        return tenantScoped(
          t('users.drawer.noSessionData'),
          secDetails ? <SessionsSection details={secDetails} fmt={fmt} /> : null,
        );
      case 'security':
        return tenantScoped(
          t('users.drawer.noDataRefresh'),
          secDetails && selectedTenantId ? (
            <SecuritySection
              details={secDetails}
              fmt={fmt}
              actions={
                <button type="button" className="admin-tab" onClick={() => doRevokeAllSessions(selectedTenantId)}>
                  {t('users.drawer.revokeAllSessions')}
                </button>
              }
            />
          ) : null,
        );
      case 'access':
        return <AdminAccessSection sessions={adminAccess} fmt={fmt} />;
    }
  }

  return (
    <SlideOutPanel
      open
      onClose={onClose}
      title={user.displayName ?? user.username ?? user.email}
      crumb={t('users.drawer.dialogLabel', { email: user.email })}
      width="wide"
      widthStorageKey="admin-user-detail"
      tabs={USER_DETAIL_TABS.map((id) => ({ id, label: TAB_LABELS[id] }))}
      activeTabId={tab}
      onTabChange={(id) => {
        const next = USER_DETAIL_TABS.find((candidate) => candidate === id);
        if (next) void loadTab(next);
      }}
      headerActions={
        user.isSuperadmin ? undefined : (
          <button
            type="button"
            className="admin-tab active"
            onClick={() => {
              onClose();
              onStartImpersonate(user);
            }}
          >
            {t('users.emulate')}
          </button>
        )
      }
    >
      {isTenantScopedTab(tab) && (
        <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)' }}>
          <Select
            className="admin-select"
            value={selectedTenantId ?? ''}
            aria-label={t('users.drawer.selectWorkspacePlaceholder')}
            onChange={(e) => {
              const tid = Number(e.target.value) || null;
              setSelectedTenantId(tid);
              if (tid) void loadTab(tab, tid);
            }}
            style={{ width: '100%' }}
          >
            <option value="">{t('users.drawer.selectWorkspacePlaceholder')}</option>
            {tenants.map((tenant) => (
              <option key={tenant.id} value={tenant.id}>
                {tenant.name} ({tenant.slug})
              </option>
            ))}
          </Select>
        </div>
      )}

      {errorMsg && (
        <div className="alert alert-error" role="alert" style={{ margin: '8px 16px 0' }}>
          {errorMsg}
        </div>
      )}

      {renderBody()}
    </SlideOutPanel>
  );
}
