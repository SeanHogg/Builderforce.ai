/**
 * One linked ticket in the rail's grid: its health ring, label (an "open the artifact" link when the
 * host routes one), meta line, parent line, the host's badge, and its actions (open, run, lineage,
 * unlink) with the run's agent picker. Presentational: the panel owns every piece of state.
 */
import type { ReactNode } from 'react';
import { HealthRing } from '../HealthRing';
import { S } from './panelStyles';
import { TicketParentLine } from './TicketParentLine';
import type { AgentOptionVM, ChatAgentVM, ChatTicketsLabels, TicketLinkVM } from './types';

export interface TicketChipProps {
  tk: TicketLinkVM;
  labels: ChatTicketsLabels;
  /** This chat's own link row for the ticket's parent, when it links that too (see the panel). */
  parentTk: TicketLinkVM | undefined;
  onOpenTicket?: (tk: TicketLinkVM) => void;
  badge?: ReactNode;
  /** Whether the Run action is offered at all (a runnable tier on a chat the platform knows). */
  runnable: boolean;
  runGate: { allowed: boolean; reason?: string };
  /** Lineage is the platform's record of which chats link the ticket: offered only when it can be read. */
  lineage: boolean;
  runOpen: boolean;
  onToggleRun: () => void;
  onRun: (agentRef: string) => void;
  onLineage: () => void;
  onUnlink: () => void;
  busy: boolean;
  agents: readonly ChatAgentVM[];
  pool: readonly AgentOptionVM[];
  poolName: (ref: string) => string;
}

export function TicketChip(props: TicketChipProps) {
  const { tk, labels, parentTk, onOpenTicket, badge, runnable, runGate, lineage, runOpen, busy, agents, pool, poolName } = props;
  return (
    <div style={S.chip}>
      <HealthRing percent={tk.progressPct} size={36} caption={tk.total > 0 ? `${tk.done}/${tk.total}` : undefined} muted={!tk.exists} ariaLabel={labels.ringAria(tk.label, tk.progressPct)} />
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, maxWidth: 160 }}>
        {onOpenTicket && tk.exists ? (
          <button type="button" title={`${labels.open} · ${tk.label}`} onClick={() => onOpenTicket(tk)} style={S.ticketLink}>{tk.label}</button>
        ) : (
          <span style={S.ticketLabel} title={tk.label}>{tk.label}</span>
        )}
        <span style={S.ticketMeta}>#{tk.ref} · {labels.kind[tk.kind]} · {tk.status}{tk.linkType === 'created' ? ` · ${labels.spawned}` : ''}</span>
        {/* Which work item this ticket belongs to. Clickable only when the
            parent is ALSO one of this chat's links, so the host is handed a
            real TicketLinkVM rather than a fabricated health row. */}
        <TicketParentLine
          parent={tk.parent}
          inParent={labels.inParent}
          openTitle={labels.open}
          onOpen={onOpenTicket && parentTk ? () => onOpenTicket(parentTk) : undefined}
        />
        {badge}
      </div>
      <div style={{ display: 'flex', gap: 2 }}>
        {onOpenTicket && tk.exists && (
          <button type="button" title={`${labels.open} · ${tk.label}`} onClick={() => onOpenTicket(tk)} style={S.icon}>↗</button>
        )}
        {runnable && tk.exists && (
          <button
            type="button"
            // Disabled + explained, not hidden: a viewer should see that
            // running exists and why they can't, matching every other
            // dispatch control. Previously this always looked live and
            // failed at click time with a role error.
            disabled={!runGate.allowed}
            aria-disabled={!runGate.allowed}
            title={runGate.allowed ? labels.run : (runGate.reason ?? labels.run)}
            onClick={props.onToggleRun}
            style={runGate.allowed ? S.icon : { ...S.icon, opacity: 0.45, cursor: 'not-allowed' }}
          >▶</button>
        )}
        {lineage && <button type="button" title={labels.lineage} onClick={props.onLineage} style={S.icon}>⑃</button>}
        <button type="button" title={labels.unlink} disabled={busy} onClick={props.onUnlink} style={S.icon}>✕</button>
      </div>
      {runOpen && (
        <select aria-label={labels.pickAgent} value="" onChange={(e) => { if (e.target.value) props.onRun(e.target.value); }} style={S.select}>
          <option style={S.option} value="">{labels.pickAgent}</option>
          {agents.map((a) => <option style={S.option} key={a.id} value={a.agentRef}>★ {poolName(a.agentRef)}</option>)}
          {pool.filter((p) => !agents.some((a) => a.agentRef === p.ref)).map((p) => <option style={S.option} key={p.ref} value={p.ref}>{p.name}</option>)}
        </select>
      )}
    </div>
  );
}
