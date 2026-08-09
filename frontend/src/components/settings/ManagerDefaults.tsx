'use client';

/**
 * Workspace panel: the AI Manager's autonomy DEFAULTS (migration 0363).
 *
 * The manager's policy resolves over three tiers — built-in default ← these workspace
 * defaults ← a project's own manager settings. Before this panel existed only the third
 * tier was reachable from the UI, so "the manager may groom the backlog but never merge"
 * had to be re-stated on every project and every new project silently started from the
 * built-in defaults. Setting it once here is the point.
 *
 * A field left on "use the built-in default" is a stored null, not an absence of
 * configuration — see ManagerAutonomyControls for why that distinction is a real control
 * and not a cosmetic one.
 *
 * Manager-gated via <RoleGate capability="manager.manage"> (block variant) so a
 * non-manager sees it disabled with the role hint rather than hidden; the server's
 * requireRole(MANAGER) on the PATCH is the real authority.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { RoleGate } from '@/components/RoleGate';
import { usePermission } from '@/lib/rbac';
import {
  ManagerAutonomyControls, ManagerEffectiveSummary, ManagerKillSwitch,
  type ManagerAutonomyValue,
} from '@/components/manager/ManagerAutonomyControls';
import {
  managerApi,
  type ManagerDefaultsResponse,
  type ManagerDefaultsPatch,
} from '@/lib/builderforceApi';

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  padding: 20,
};
const sectionTitle: React.CSSProperties = {
  fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6,
};
const helpText: React.CSSProperties = {
  fontSize: 12, color: 'var(--text-muted)', margin: '0 0 16px',
};

function ManagerDefaultsInner() {
  const t = useTranslations('settings');
  const tm = useTranslations('manager');
  const { allowed } = usePermission('manager.manage');

  const [data, setData] = useState<ManagerDefaultsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await managerApi.defaults());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('managerDefaultsError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  // Save on change, matching the per-project manager policy form. The response carries
  // the freshly-resolved policy, so the "in effect right now" strip updates from the
  // server's own fold rather than from a local guess about precedence.
  const save = useCallback(async (patch: ManagerDefaultsPatch) => {
    if (!allowed) return;
    setSaving(true);
    try {
      setData(await managerApi.updateDefaults(patch));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('managerDefaultsError'));
      await load();
    } finally {
      setSaving(false);
    }
  }, [allowed, load, t]);

  if (loading && !data) {
    return <div style={{ ...cardStyle, color: 'var(--text-muted)', fontSize: 13 }}>{tm('loading')}</div>;
  }
  if (!data) {
    return (
      <div style={{ ...cardStyle, fontSize: 13 }}>
        <div style={sectionTitle}>{t('managerDefaultsTitle')}</div>
        <p style={{ ...helpText, marginBottom: 0 }}>{error ?? t('managerDefaultsError')}</p>
      </div>
    );
  }

  const stored = data.defaults;
  // The opinions stored AT THE WORKSPACE TIER. Every one is nullable, so this is the raw
  // row — never the resolved policy, which would make "not set" indistinguishable from a
  // deliberate choice that happens to match the built-in default.
  const value: ManagerAutonomyValue = {
    enabled: stored?.enabled ?? null,
    allowAutoMerge: stored?.allowAutoMerge ?? null,
    requireSignoffToComplete: stored?.requireSignoffToComplete ?? null,
    prMergePolicy: stored?.prMergePolicy ?? null,
    autoAssign: stored?.autoAssign ?? null,
    autoBusinessValue: stored?.autoBusinessValue ?? null,
    autoPrioritize: stored?.autoPrioritize ?? null,
    autoSchedule: stored?.autoSchedule ?? null,
    allowUnattendedCeremonies: stored?.allowUnattendedCeremonies ?? null,
    allowAgentReassignment: stored?.allowAgentReassignment ?? null,
    allowAutoStaffLanes: stored?.allowAutoStaffLanes ?? null,
    agentReassignIdleHours: stored?.agentReassignIdleHours ?? null,
    agentReassignMaxPerSession: stored?.agentReassignMaxPerSession ?? null,
  };

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ minWidth: 0, flex: '1 1 420px' }}>
          <div style={sectionTitle}>{t('managerDefaultsTitle')}</div>
          <p style={{ ...helpText, marginBottom: 0 }}>{t('managerDefaultsSubtitle')}</p>
        </div>
        <ManagerKillSwitch
          checked={data.policy.enabled}
          disabled={saving || !allowed}
          onChange={(enabled) => void save({ enabled })}
        />
      </div>

      {error && (
        <p style={{ fontSize: 12, color: 'var(--coral-bright, #ef4444)', margin: '0 0 12px' }}>{error}</p>
      )}

      {/* What a project with no manager settings of its own gets — server-resolved. */}
      <ManagerEffectiveSummary effective={data.policy} />

      <ManagerAutonomyControls
        tier="workspace"
        value={value}
        effective={data.policy}
        inherited={data.builtinPolicy}
        disabled={saving || !allowed}
        showEnabled={false}
        onChange={(patch) => void save(patch)}
      />

      <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '16px 0 0' }}>
        {t('managerDefaultsProjectHint')}{' '}
        <Link href="/projects?tab=manager&sub=policy" style={{ color: 'var(--accent, #2563eb)' }}>
          {t('managerDefaultsProjectLink')}
        </Link>
      </p>
    </div>
  );
}

export default function ManagerDefaults() {
  return (
    <RoleGate capability="manager.manage" variant="block">
      <ManagerDefaultsInner />
    </RoleGate>
  );
}
