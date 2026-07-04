'use client';

/**
 * RoleAssigneePicker — the shared "assign an existing teammate to a role" control,
 * used by BOTH the project Recommended Roster card and the Workforce → Roles tab.
 * Lets a manager pick a kind (Agent / Employee / Hire) and then a specific member
 * of the existing workforce. Self-contained: loads its own candidate lists via
 * {@link useAssignableWorkforce} and decides its own manager-only visibility.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
import { listMyAgents, listPurchasedAgents } from '@/lib/api';
import { listTenantMembers } from '@/lib/auth';
import { listEngagements } from '@/lib/freelancerApi';
import type { AssigneeKind } from '@/lib/kanban';

export interface AssigneeCandidate { ref: string; name: string }
export interface AssignableWorkforce {
  agents: AssigneeCandidate[];
  humans: AssigneeCandidate[];
  hires: AssigneeCandidate[];
  loading: boolean;
  reload: () => void;
}

/** Load the three assignable pools (agents, human members, active hires). Reuses the
 *  existing list endpoints so there is no new backend fan-out to keep in sync. Pass
 *  `enabled=false` to defer the fetch until the caller actually needs the lists (e.g.
 *  a roster card only needs them once a picker opens). */
export function useAssignableWorkforce(enabled = true): AssignableWorkforce {
  const { tenant, tenantToken } = useAuth();
  const [agents, setAgents] = useState<AssigneeCandidate[]>([]);
  const [humans, setHumans] = useState<AssigneeCandidate[]>([]);
  const [hires, setHires] = useState<AssigneeCandidate[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [mine, purchased] = await Promise.all([
        listMyAgents().catch(() => []),
        listPurchasedAgents().catch(() => []),
      ]);
      const byId = new Map<string, AssigneeCandidate>();
      for (const a of [...mine, ...purchased]) byId.set(a.id, { ref: a.id, name: a.name });
      setAgents([...byId.values()]);

      if (tenant && tenantToken) {
        const members = await listTenantMembers(tenantToken, String(tenant.id)).catch(() => []);
        setHumans(members.map((m) => ({ ref: m.id, name: m.displayName ?? m.username ?? m.email })));
      } else {
        setHumans([]);
      }

      const engagements = await listEngagements().catch(() => []);
      setHires(
        engagements
          .filter((e) => e.status !== 'terminated' && e.status !== 'declined')
          .map((e) => ({ ref: e.freelancerUserId, name: e.freelancerName ?? e.freelancerUserId })),
      );
    } finally {
      setLoading(false);
    }
  }, [tenant, tenantToken]);

  // Fetch once when first enabled; re-runs only if enabled flips true or the tenant changes.
  const [fetched, setFetched] = useState(false);
  useEffect(() => {
    if (enabled && !fetched) { setFetched(true); void load(); }
  }, [enabled, fetched, load]);

  return { agents, humans, hires, loading: loading && (enabled || fetched), reload: () => void load() };
}

const KINDS: { id: AssigneeKind; labelKey: string }[] = [
  { id: 'agent', labelKey: 'assigneeAgent' },
  { id: 'human', labelKey: 'assigneeHuman' },
  { id: 'hire', labelKey: 'assigneeHire' },
];

export function RoleAssigneePicker({
  workforce,
  onAssign,
  onCancel,
  busy,
}: {
  workforce: AssignableWorkforce;
  onAssign: (a: { assigneeKind: AssigneeKind; assigneeRef: string; assigneeName: string }) => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  const t = useTranslations('kanban');
  const [kind, setKind] = useState<AssigneeKind>('agent');
  const [ref, setRef] = useState('');

  const candidates = kind === 'agent' ? workforce.agents : kind === 'human' ? workforce.humans : workforce.hires;
  const selected = useMemo(() => candidates.find((c) => c.ref === ref), [candidates, ref]);

  // Reset the selection when the kind changes so a stale ref can't be submitted.
  useEffect(() => { setRef(''); }, [kind]);

  const seg: React.CSSProperties = {
    flex: 1, padding: '5px 8px', fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none', background: 'transparent', color: 'var(--text-secondary)',
  };
  const segActive: React.CSSProperties = { ...seg, background: 'var(--accent, #2563eb)', color: '#fff' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 10, borderRadius: 8, background: 'var(--surface-2)', border: '1px solid var(--border-subtle)' }}>
      <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
        {KINDS.map((k) => (
          <button key={k.id} type="button" onClick={() => setKind(k.id)} style={kind === k.id ? segActive : seg}>
            {t(k.labelKey)}
          </button>
        ))}
      </div>
      <select
        value={ref}
        onChange={(e) => setRef(e.target.value)}
        disabled={workforce.loading || candidates.length === 0}
        aria-label={t('assignPick')}
        style={{ padding: '6px 8px', borderRadius: 8, fontSize: 13, background: 'var(--surface)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
      >
        <option value="">
          {workforce.loading ? t('assignLoading') : candidates.length === 0 ? t('assignNoneOfKind') : t('assignPick')}
        </option>
        {candidates.map((c) => (
          <option key={c.ref} value={c.ref}>{c.name}</option>
        ))}
      </select>
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button type="button" onClick={onCancel} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 6, cursor: 'pointer', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
          {t('assignCancel')}
        </button>
        <button
          type="button"
          disabled={!selected || busy}
          onClick={() => selected && onAssign({ assigneeKind: kind, assigneeRef: selected.ref, assigneeName: selected.name })}
          style={{ fontSize: 12, padding: '5px 12px', borderRadius: 6, cursor: selected ? 'pointer' : 'not-allowed', background: 'var(--accent, #2563eb)', color: '#fff', border: 'none', opacity: selected && !busy ? 1 : 0.5 }}
        >
          {busy ? t('assignSaving') : t('assignConfirm')}
        </button>
      </div>
    </div>
  );
}
