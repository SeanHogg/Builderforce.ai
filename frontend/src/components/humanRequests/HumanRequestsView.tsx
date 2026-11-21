import { Select } from '@/components/Select';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { approvalsApi, agentHosts, type Approval, type ApprovalStatus, type RequestKind, type AgentHost } from '@/lib/builderforceApi';
import { LocalCollection } from '@/components/pm/LocalCollection';
import { TicketDetailsPanel } from '@/components/task/TicketDetailsPanel';
import { useFormat } from "@/i18n/useFormat";
import { useErrorMessage } from '@/i18n/useErrorMessage';
import { humanRequestsDescriptor } from './humanRequestsDescriptor';
/**
 * Human-in-the-loop request queue — the portal side of the agent's `ask_human`
 * tool. Lists every request an agent has bubbled up (approvals, questions,
 * feedback) and lets a person resolve it: approve/reject an action, or answer a
 * question/feedback with free text. Resolving a request unblocks the agent that
 * is waiting on it.
 *
 * Fully reusable / self-contained: it owns its own fetch, filters, and resolve
 * calls, takes no required props, and renders no page chrome — so it drops into
 * the Workforce tab, an agent-host detail panel, a dashboard widget, or a task
 * drawer. Layout-only; auth/tenant gating is the surrounding shell's job.
 *
 * The rows render through the ONE shared Collection (PRD 47): Card | List, sort,
 * search and paging are its job; the kind / status / agent-host filters and Refresh
 * sit in its header slot.
 */

type KindFilter = '' | RequestKind;
type StatusFilter = '' | ApprovalStatus;

/** Filter orders. Labels resolve under `humanRequests.kindPlural.*` / `humanRequests.status.*`. */
const KIND_FILTERS: readonly RequestKind[] = ['approval', 'question', 'feedback'];
const STATUS_FILTERS: readonly ApprovalStatus[] = ['pending', 'approved', 'rejected', 'answered', 'expired'];

const searchText = (r: Approval): string =>
  [r.id, r.actionType, r.description, r.requestedBy, r.reviewedBy, r.responseText].filter(Boolean).join(' ');

export interface HumanRequestsViewProps {
  /** Preselect (and hide) the kind filter — e.g. a Questions-only widget. */
  defaultKind?: KindFilter;
  /** Initial status filter. Defaults to 'pending'. */
  defaultStatus?: StatusFilter;
  /** Lock the queue to a single agent host and hide the host filter. */
  lockedAgentHostId?: number;
  /** Card-first layout for embedding in a panel/drawer. */
  compact?: boolean;
  /** Fired after each load with the number of pending requests in view. */
  onPendingCountChange?: (count: number) => void;
}

export function HumanRequestsView({
  defaultKind = '',
  defaultStatus = 'pending',
  lockedAgentHostId,
  compact = false,
  onPendingCountChange,
}: HumanRequestsViewProps = {}) {
  const t = useTranslations('humanRequests');
  const fmt = useFormat();
  const errorMessage = useErrorMessage();
  const [rows, setRows] = useState<Approval[]>([]);
  const [agentHostList, setAgentHostList] = useState<AgentHost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<KindFilter>(defaultKind);
  const [status, setStatus] = useState<StatusFilter>(defaultStatus);
  const [agentHostId, setAgentHostId] = useState<string>(lockedAgentHostId != null ? String(lockedAgentHostId) : '');
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [approvals, agentHostsData] = await Promise.all([
        approvalsApi.list({
          status: status || undefined,
          agentHostId: agentHostId ? Number(agentHostId) : undefined,
        }),
        lockedAgentHostId != null ? Promise.resolve([] as AgentHost[]) : agentHosts.list().catch(() => [] as AgentHost[]),
      ]);
      setRows(approvals);
      if (lockedAgentHostId == null) setAgentHostList(agentHostsData);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [status, agentHostId, lockedAgentHostId, errorMessage]);

  useEffect(() => {
    void load();
  }, [load]);

  const agentHostNameById = useMemo(() => {
    const map = new Map<number, string>();
    for (const agentHost of agentHostList) map.set(agentHost.id, agentHost.name);
    return map;
  }, [agentHostList]);

  const filtered = useMemo(() => (kind ? rows.filter((r) => r.kind === kind) : rows), [rows, kind]);

  // Report the pending count in view so a host page/widget can badge it.
  useEffect(() => {
    onPendingCountChange?.(filtered.filter((r) => r.status === 'pending').length);
  }, [filtered, onPendingCountChange]);

  const descriptor = useMemo(() => {
    const base = humanRequestsDescriptor({
      t,
      fmt,
      compact,
      agentHostLabel: (row) => (row.agentHostId != null ? agentHostNameById.get(row.agentHostId) ?? `#${row.agentHostId}` : '-'),
      onViewTicket: setSelectedTaskId,
      onResolved: () => void load(),
    });
    // While a (re)load is in flight an empty list reads "Loading…", not "No requests".
    return loading ? { ...base, emptyKey: 'loading' } : base;
  }, [t, fmt, compact, agentHostNameById, load, loading]);

  return (
    <div>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 16px' }}>
        {t('intro')}
      </p>

      {error && (
        <div
          style={{
            marginBottom: 12, padding: '10px 12px',
            border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)',
            background: 'var(--danger-bg)', color: 'var(--text-primary)', fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      <LocalCollection descriptor={descriptor} rows={filtered} searchText={searchText}>
        {!defaultKind && (
          <Select className="admin-select" aria-label={t('column.kind')} value={kind} onChange={(e) => setKind(e.target.value as KindFilter)}>
            <option value="">{t('allKinds')}</option>
            {KIND_FILTERS.map((value) => (
              <option key={value} value={value}>{t(`kindPlural.${value}`)}</option>
            ))}
          </Select>
        )}

        <Select className="admin-select" aria-label={t('column.status')} value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
          <option value="">{t('allStatuses')}</option>
          {STATUS_FILTERS.map((value) => (
            <option key={value} value={value}>{t(`status.${value}`)}</option>
          ))}
        </Select>

        {lockedAgentHostId == null && (
          <Select className="admin-select" aria-label={t('column.agentHost')} value={agentHostId} onChange={(e) => setAgentHostId(e.target.value)}>
            <option value="">{t('allAgentHosts')}</option>
            {agentHostList.map((c) => (
              <option key={c.id} value={String(c.id)}>{c.name}</option>
            ))}
          </Select>
        )}

        <button type="button" className="btn-ghost" onClick={() => void load()} disabled={loading}>
          {loading ? t('refreshing') : t('refresh')}
        </button>
      </LocalCollection>
      <TicketDetailsPanel taskId={selectedTaskId} onClose={() => setSelectedTaskId(null)} />
    </div>
  );
}
