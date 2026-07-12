/**
 * ChatTicketsPanel — the shared chat↔ticket surface (web app + VS Code webview).
 *
 * Under a chat's header it shows a health ring (% done) for every linked ticket
 * of any tier (portfolio · objective/OKR · initiative · epic · task); link/unlink
 * controls with a per-tier picker; the chat↔ticket lineage; a "merge into this
 * chat" consolidator; and an agent roster where a teammate agent is invited as a
 * participant OR tagged to EXECUTE a linked task/epic.
 *
 * Presentational + self-managing: it owns its UI state and calls a host-injected
 * {@link ChatTicketsAdapter} for all data. Styling is CSS-var driven (light+dark);
 * strings come from an injected {@link ChatTicketsLabels} bundle. Native <select>s
 * keep it dependency-free so both hosts render it identically.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HealthRing } from '../HealthRing';
import {
  RUNNABLE_KINDS, TICKET_KINDS,
  type ChatTicketsAdapter, type ChatTicketsLabels, type TicketKind,
  type TicketLinkVM, type ChatAgentVM, type ChatMemberVM, type AgentOptionVM, type LineageVM, type TicketOptionVM, type ChatOptionVM, type LinkType,
} from './types';

export interface ChatTicketsPanelProps {
  chatId: number;
  projectId: number | null;
  /** Other chats (for the merge picker). */
  chatList: ChatOptionVM[];
  adapter: ChatTicketsAdapter;
  labels: ChatTicketsLabels;
  /** Called after a change to the chat's roster/lineage — a merge, or an agent
   *  invite/removal — so the host can refresh its chat list (e.g. the sidebar's
   *  per-session participant indicators). */
  onChanged?: () => void;
  /** Bump to force a reload of tickets + agents — the host raises this when the
   *  Brain mutates work items via MCP tools (link/merge/invite/task move) so the
   *  panel doesn't go stale after a change it didn't originate. */
  refreshSignal?: number;
  /** Current LOCK state of the chat. When provided (with {@link onSetVisibility})
   *  the People section shows a shared/locked toggle. Owner-gated by the host. */
  visibility?: 'shared' | 'locked';
  /** Flip the chat's LOCK state (owner only). Omit to hide the toggle. */
  onSetVisibility?: (v: 'shared' | 'locked') => Promise<void>;
  /** Open a linked work item / artifact in its own view — the host routes it (web:
   *  SPA nav to the board/OKR/spec; VS Code: a bridge message the extension handles).
   *  When provided, each ticket's label becomes a clickable "open the artifact" link
   *  so every item the Brain created from this chat is one click from its board card. */
  onOpenTicket?: (tk: TicketLinkVM) => void;
}

const RUNNABLE = new Set<TicketKind>(RUNNABLE_KINDS);

/** A chat can accumulate hundreds of linked tickets — auto-collapse the health-ring
 *  grid past this many so it doesn't push the composer off-screen. The user can still
 *  expand/collapse manually; once they do, we stop auto-deciding for this chat. */
const COLLAPSE_THRESHOLD = 8;

function ChatTicketsPanelInner({ chatId, projectId, chatList, adapter, labels, onChanged, refreshSignal, visibility, onSetVisibility, onOpenTicket }: ChatTicketsPanelProps) {
  const [tickets, setTickets] = useState<TicketLinkVM[]>([]);
  const [agents, setAgents] = useState<ChatAgentVM[]>([]);
  const [members, setMembers] = useState<ChatMemberVM[]>([]);
  const [pool, setPool] = useState<AgentOptionVM[]>([]);
  const [panel, setPanel] = useState<null | 'link' | 'agents' | 'people' | 'merge'>(null);
  const [lineageKey, setLineageKey] = useState<string | null>(null);
  const [lineage, setLineage] = useState<LineageVM[]>([]);
  const [runKey, setRunKey] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Collapse the ticket grid. `null` = "haven't decided yet" → auto-collapse a long
  // list on first load; a bool = the user chose, and we respect it from then on.
  const [collapsed, setCollapsed] = useState<boolean | null>(null);
  const userCollapsed = useRef(false);

  const load = useCallback(async () => {
    const [tk, ag, mem] = await Promise.all([
      adapter.listTickets(chatId).catch(() => [] as TicketLinkVM[]),
      adapter.listAgents(chatId).catch(() => [] as ChatAgentVM[]),
      adapter.listMembers(chatId).catch(() => [] as ChatMemberVM[]),
    ]);
    setTickets(tk);
    setAgents(ag);
    setMembers(mem);
    // Auto-collapse a long list on first load; never override a user's own choice.
    if (!userCollapsed.current) setCollapsed(tk.length > COLLAPSE_THRESHOLD);
  }, [adapter, chatId]);

  useEffect(() => { void load(); }, [load, refreshSignal]);
  useEffect(() => { adapter.loadAgentPool().then(setPool).catch(() => setPool([])); }, [adapter]);

  const flash = (m: string) => { setMsg(m); if (typeof window !== 'undefined') window.setTimeout(() => setMsg(null), 3500); };
  const poolName = useCallback((ref: string) => pool.find((p) => p.ref === ref)?.name ?? ref, [pool]);

  const unlink = async (tk: TicketLinkVM) => {
    setBusy(true);
    try { await adapter.unlinkTicket(chatId, tk.kind, tk.ref); await load(); } finally { setBusy(false); }
  };

  const openLineage = async (tk: TicketLinkVM) => {
    const key = `${tk.kind}:${tk.ref}`;
    if (lineageKey === key) { setLineageKey(null); return; }
    setLineageKey(key);
    setLineage(await adapter.listTicketChats(tk.kind, tk.ref).catch(() => []));
  };

  const runTicket = async (tk: TicketLinkVM, agentRef: string) => {
    setBusy(true);
    try {
      const res = await adapter.runTicket(tk.kind, tk.ref, agentRef);
      flash(res.started ? labels.runStarted(res.agentName || poolName(agentRef)) : labels.runNoAgent);
      setRunKey(null);
      await load();
    } catch (e) {
      flash(e instanceof Error ? e.message : labels.runFailed);
    } finally { setBusy(false); }
  };

  // Roll the linked tickets up into one overall % for the collapsed header ring:
  // work-weighted (Σdone / Σtotal) when any ticket has sub-items, else the mean of
  // the per-ticket rings so a flat list of leaf tasks still reads a sensible number.
  const agg = useMemo(() => {
    let done = 0, total = 0, sumPct = 0;
    for (const tk of tickets) { done += tk.done; total += tk.total; sumPct += tk.progressPct; }
    const pct = total > 0 ? Math.round((done / total) * 100)
      : tickets.length ? Math.round(sumPct / tickets.length) : 0;
    return { pct, done, total };
  }, [tickets]);

  const isCollapsed = tickets.length > 0 && (collapsed ?? tickets.length > COLLAPSE_THRESHOLD);
  const toggleCollapsed = () => { userCollapsed.current = true; setCollapsed(!isCollapsed); };

  return (
    <div style={S.root}>
      {/* Collapsible header — one row summarising the linked tickets so a chat with
          hundreds of them stays compact. Click to expand/collapse the ring grid. */}
      {tickets.length > 0 && (
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-expanded={!isCollapsed}
          title={isCollapsed ? labels.showTickets : labels.hideTickets}
          style={S.ticketsHeader}
        >
          <span aria-hidden style={{ ...S.caret, transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)' }}>▸</span>
          <HealthRing percent={agg.pct} size={22} muted={false} ariaLabel={labels.overallAria(agg.pct)} />
          <span style={S.ticketsCount}>{labels.ticketCount(tickets.length)}</span>
          <span style={S.ticketsAgg}>{agg.pct}%{agg.total > 0 ? ` · ${agg.done}/${agg.total}` : ''}</span>
        </button>
      )}

      {/* Health rings for linked tickets */}
      {!isCollapsed && (
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        {tickets.length === 0 ? (
          <span style={S.muted}>{labels.none}</span>
        ) : tickets.map((tk) => {
          const key = `${tk.kind}:${tk.ref}`;
          return (
            <div key={tk.linkId} style={S.chip}>
              <HealthRing percent={tk.progressPct} size={36} caption={tk.total > 0 ? `${tk.done}/${tk.total}` : undefined} muted={!tk.exists} ariaLabel={labels.ringAria(tk.label, tk.progressPct)} />
              <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, maxWidth: 160 }}>
                {onOpenTicket && tk.exists ? (
                  <button type="button" title={`${labels.open} · ${tk.label}`} onClick={() => onOpenTicket(tk)} style={S.ticketLink}>{tk.label}</button>
                ) : (
                  <span style={S.ticketLabel} title={tk.label}>{tk.label}</span>
                )}
                <span style={S.ticketMeta}>{labels.kind[tk.kind]} · {tk.status}{tk.linkType === 'created' ? ` · ${labels.spawned}` : ''}</span>
              </div>
              <div style={{ display: 'flex', gap: 2 }}>
                {onOpenTicket && tk.exists && (
                  <button type="button" title={`${labels.open} · ${tk.label}`} onClick={() => onOpenTicket(tk)} style={S.icon}>↗</button>
                )}
                {RUNNABLE.has(tk.kind) && tk.exists && (
                  <button type="button" title={labels.run} onClick={() => setRunKey(runKey === key ? null : key)} style={S.icon}>▶</button>
                )}
                <button type="button" title={labels.lineage} onClick={() => void openLineage(tk)} style={S.icon}>⑃</button>
                <button type="button" title={labels.unlink} disabled={busy} onClick={() => void unlink(tk)} style={S.icon}>✕</button>
              </div>
              {runKey === key && (
                <select aria-label={labels.pickAgent} value="" onChange={(e) => { if (e.target.value) void runTicket(tk, e.target.value); }} style={S.select}>
                  <option value="">{labels.pickAgent}</option>
                  {agents.map((a) => <option key={a.id} value={a.agentRef}>★ {poolName(a.agentRef)}</option>)}
                  {pool.filter((p) => !agents.some((a) => a.agentRef === p.ref)).map((p) => <option key={p.ref} value={p.ref}>{p.name}</option>)}
                </select>
              )}
            </div>
          );
        })}
      </div>
      )}

      {/* Lineage drawer */}
      {lineageKey && (
        <div style={S.drawer}>
          <strong style={{ color: V.text }}>{labels.lineageTitle}</strong>
          {lineage.length === 0 ? <span style={{ marginLeft: 8, ...S.muted }}>{labels.lineageEmpty}</span> : (
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
              {lineage.map((c) => (
                <li key={c.chatId} style={{ marginBottom: 2 }}>
                  <span style={{ fontWeight: c.chatId === chatId ? 700 : 400 }}>{c.title}</span>
                  {c.linkType === 'created' ? <em style={{ color: V.accent, marginLeft: 6 }}>{labels.spawned}</em> : null}
                  {c.isArchived ? <span style={{ marginLeft: 6, ...S.muted }}>({labels.merged})</span> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Action toggles */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => setPanel(panel === 'link' ? null : 'link')} style={S.pill(panel === 'link')}>＋ {labels.link}</button>
        <button type="button" onClick={() => setPanel(panel === 'agents' ? null : 'agents')} style={S.pill(panel === 'agents')}>👥 {labels.agents}{agents.length ? ` (${agents.length})` : ''}</button>
        <button type="button" onClick={() => setPanel(panel === 'people' ? null : 'people')} style={S.pill(panel === 'people')}>👤 {labels.people}{members.length ? ` (${members.length})` : ''}</button>
        <button type="button" onClick={() => setPanel(panel === 'merge' ? null : 'merge')} style={S.pill(panel === 'merge')}>⧉ {labels.merge}</button>
        {msg && <span style={{ fontSize: 12, color: V.accent, alignSelf: 'center' }}>{msg}</span>}
      </div>

      {panel === 'link' && <LinkForm search={adapter.searchTickets} projectId={projectId} existing={tickets} labels={labels} onLink={async (kind, ref, linkType) => {
        try { await adapter.linkTicket(chatId, { kind, ref, linkType }); await load(); }
        catch (e) { flash(e instanceof Error ? e.message : labels.linkFailed); }
      }} />}

      {panel === 'agents' && <AgentsSection agents={agents} pool={pool} labels={labels}
        onInvite={async (ref, kind) => { setBusy(true); try { await adapter.inviteAgent(chatId, { agentRef: ref, agentKind: kind }); await load(); onChanged?.(); } finally { setBusy(false); } }}
        onRemove={async (id) => { setBusy(true); try { await adapter.removeAgent(chatId, id); await load(); onChanged?.(); } finally { setBusy(false); } }}
        busy={busy} />}

      {panel === 'people' && <PeopleSection members={members} labels={labels}
        visibility={visibility} onSetVisibility={onSetVisibility}
        onInvite={async (email) => { setBusy(true); try { const r = await adapter.inviteMember(chatId, email); flash(r.status === 'pending' ? labels.invitePending : labels.inviteSent); await load(); onChanged?.(); } catch (e) { flash(e instanceof Error ? e.message : labels.linkFailed); } finally { setBusy(false); } }}
        onRemove={async (id) => { setBusy(true); try { await adapter.removeMember(chatId, id); await load(); onChanged?.(); } finally { setBusy(false); } }}
        busy={busy} />}

      {panel === 'merge' && <MergeSection chatId={chatId} chatList={chatList} labels={labels}
        onMerge={async (ids) => { setBusy(true); try { await adapter.consolidate(chatId, ids); flash(labels.mergedN(ids.length)); await load(); onChanged?.(); } finally { setBusy(false); } }}
        busy={busy} />}
    </div>
  );
}

// ── Link a ticket ────────────────────────────────────────────────────────────

/** How many hits the server returns per tier. When a result set fills this, there
 *  are (probably) more — we nudge the user to type instead of silently truncating. */
const SEARCH_LIMIT = 40;

function LinkForm({ search, projectId, existing, labels, onLink }: {
  /** Server-side typeahead — the adapter debounces nothing itself; we debounce here. */
  search: (kind: TicketKind, query: string, projectId: number | null) => Promise<TicketOptionVM[]>;
  projectId: number | null;
  existing: TicketLinkVM[];
  labels: ChatTicketsLabels;
  onLink: (kind: TicketKind, ref: string, linkType: LinkType) => Promise<void>;
}) {
  const [kind, setKind] = useState<TicketKind>('task');
  const [ref, setRef] = useState('');
  const [query, setQuery] = useState('');
  const [linkType, setLinkType] = useState<LinkType>('linked');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<TicketOptionVM[]>([]);
  const [loading, setLoading] = useState(false);

  // Debounced server-side typeahead on (kind, query, project). The `live` flag drops
  // a stale response so a slow earlier request can't overwrite a newer one, and the
  // timer is cleared on every keystroke so only the settled query hits the network.
  useEffect(() => {
    let live = true;
    setLoading(true);
    const h = setTimeout(() => {
      search(kind, query, projectId)
        .then((r) => { if (live) setResults(r); })
        .catch(() => { if (live) setResults([]); })
        .finally(() => { if (live) setLoading(false); });
    }, 250);
    return () => { live = false; clearTimeout(h); };
  }, [search, kind, query, projectId]);

  // Hide tickets already linked to this chat (the server doesn't know the chat's links).
  const shown = useMemo(
    () => results.filter((o) => !existing.some((e) => e.kind === kind && e.ref === o.ref)),
    [results, existing, kind],
  );
  const atCap = results.length >= SEARCH_LIMIT;

  // Drop a chosen ref once it's no longer in the visible set (kind switch / new search).
  useEffect(() => { if (ref && !shown.some((o) => o.ref === ref)) setRef(''); }, [shown, ref]);

  const submit = async () => {
    if (!ref) return;
    setBusy(true);
    try { await onLink(kind, ref, linkType); setRef(''); setQuery(''); } finally { setBusy(false); }
  };

  return (
    <div style={S.section}>
      <select aria-label={labels.kindLabel} value={kind} onChange={(e) => { setKind(e.target.value as TicketKind); setRef(''); setQuery(''); }} style={S.select}>
        {TICKET_KINDS.map((k) => <option key={k} value={k}>{labels.kind[k]}</option>)}
      </select>
      <input
        type="search"
        aria-label={labels.searchTicket}
        placeholder={labels.searchTicket}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ ...S.select, minWidth: 150 }}
      />
      <select aria-label={labels.pickTicket} value={ref} onChange={(e) => setRef(e.target.value)} style={{ ...S.select, minWidth: 200 }}>
        <option value="">{labels.pickTicket}</option>
        {shown.map((o) => <option key={o.ref} value={o.ref}>{o.label}</option>)}
      </select>
      {loading ? <span style={S.muted}>{labels.searching}</span>
        : shown.length === 0 ? <span style={S.muted}>{labels.noMatches}</span>
        : atCap ? <span style={S.muted}>{labels.refine}</span>
        : null}
      <select aria-label={labels.linkTypeLabel} value={linkType} onChange={(e) => setLinkType(e.target.value as LinkType)} style={S.select}>
        <option value="linked">{labels.linkTypeLinked}</option>
        <option value="created">{labels.linkTypeCreated}</option>
      </select>
      <button type="button" onClick={() => void submit()} disabled={busy || !ref} style={S.pill(true)}>{busy ? '…' : labels.linkAction}</button>
    </div>
  );
}

// ── Agents in the chat ───────────────────────────────────────────────────────

function AgentsSection({ agents, pool, labels, onInvite, onRemove, busy }: {
  agents: ChatAgentVM[]; pool: AgentOptionVM[]; labels: ChatTicketsLabels;
  onInvite: (ref: string, kind: string) => Promise<void>; onRemove: (id: string) => Promise<void>; busy: boolean;
}) {
  const poolName = (ref: string) => pool.find((p) => p.ref === ref)?.name ?? ref;
  const uninvited = pool.filter((p) => !agents.some((a) => a.agentRef === p.ref));
  return (
    <div style={{ ...S.section, flexDirection: 'column', alignItems: 'stretch' }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {agents.length === 0 ? <span style={S.muted}>{labels.noAgents}</span> : agents.map((a) => (
          <span key={a.id} style={S.agentChip}>
            <span aria-hidden>🤖</span>{poolName(a.agentRef)}
            <button type="button" title={labels.removeAgent} disabled={busy} onClick={() => void onRemove(a.id)} style={{ ...S.icon, fontSize: 11 }}>✕</button>
          </span>
        ))}
      </div>
      <select aria-label={labels.inviteAgent} value="" onChange={(e) => { const p = pool.find((x) => x.ref === e.target.value); if (p) void onInvite(p.ref, p.kind); }} style={{ ...S.select, maxWidth: 260 }}>
        <option value="">{labels.inviteAgent}</option>
        {uninvited.map((p) => <option key={p.ref} value={p.ref}>{p.name} — {p.meta}</option>)}
      </select>
      <span style={{ fontSize: 11, ...S.muted }}>{labels.agentsHint}</span>
    </div>
  );
}

// ── People in the chat (human members / audience) ────────────────────────────

function PeopleSection({ members, labels, visibility, onSetVisibility, onInvite, onRemove, busy }: {
  members: ChatMemberVM[]; labels: ChatTicketsLabels;
  visibility?: 'shared' | 'locked'; onSetVisibility?: (v: 'shared' | 'locked') => Promise<void>;
  onInvite: (email: string) => Promise<void>; onRemove: (id: number) => Promise<void>; busy: boolean;
}) {
  const [email, setEmail] = useState('');
  const submit = async () => {
    const e = email.trim();
    if (!e) return;
    await onInvite(e);
    setEmail('');
  };
  const locked = visibility === 'locked';
  return (
    <div style={{ ...S.section, flexDirection: 'column', alignItems: 'stretch' }}>
      {visibility && onSetVisibility && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" disabled={busy} onClick={() => void onSetVisibility(locked ? 'shared' : 'locked')} style={S.pill(locked)}>
            {locked ? `🔒 ${labels.visibilityLocked}` : `🔓 ${labels.visibilityShared}`}
          </button>
          <span style={{ fontSize: 11, ...S.muted }}>{labels.lockHint}</span>
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {members.length === 0 ? <span style={S.muted}>{labels.noPeople}</span> : members.map((m) => (
          <span key={m.id} style={S.agentChip}>
            <span aria-hidden>{m.status === 'pending' ? '✉️' : '👤'}</span>{m.name}
            <button type="button" title={labels.removePerson} disabled={busy} onClick={() => void onRemove(m.id)} style={{ ...S.icon, fontSize: 11 }}>✕</button>
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          type="email" value={email} disabled={busy}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
          placeholder={labels.invitePerson} aria-label={labels.invitePerson}
          style={{ ...S.select, flex: 1, maxWidth: 260 }}
        />
        <button type="button" disabled={busy || !email.trim()} onClick={() => void submit()} style={S.pill(false)}>＋</button>
      </div>
      <span style={{ fontSize: 11, ...S.muted }}>{labels.invitePersonHint}</span>
    </div>
  );
}

// ── Merge (consolidate) chats ────────────────────────────────────────────────

function MergeSection({ chatId, chatList, labels, onMerge, busy }: {
  chatId: number; chatList: ChatOptionVM[]; labels: ChatTicketsLabels;
  onMerge: (ids: number[]) => Promise<void>; busy: boolean;
}) {
  const [selected, setSelected] = useState<number[]>([]);
  const candidates = chatList.filter((c) => c.id !== chatId);
  const toggle = (id: number) => setSelected((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
  return (
    <div style={{ ...S.section, flexDirection: 'column', alignItems: 'stretch' }}>
      <span style={{ fontSize: 12, color: V.text2 }}>{labels.mergeHint}</span>
      <div style={{ maxHeight: 160, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {candidates.length === 0 ? <span style={S.muted}>{labels.mergeNoOthers}</span> : candidates.map((c) => (
          <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '3px 4px', cursor: 'pointer' }}>
            <input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggle(c.id)} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</span>
          </label>
        ))}
      </div>
      <button type="button" onClick={() => { if (selected.length) void onMerge(selected).then(() => setSelected([])); }} disabled={busy || selected.length === 0} style={S.pill(true)}>
        {busy ? '…' : labels.mergeAction(selected.length)}
      </button>
    </div>
  );
}

/**
 * Memoized: this panel sits directly under the composer, so it would otherwise
 * reconcile its whole subtree (health-ring SVGs, selects, link/merge/agents forms)
 * on every keystroke and streaming token. Callers must pass referentially stable
 * props (memoize `chatList` and `onChanged`) for the memo to take effect.
 */
export const ChatTicketsPanel = memo(ChatTicketsPanelInner);

// ── theme tokens ──────────────────────────────────────────────────────────────
// Each value is a CSS-var fallback CHAIN read left→right: first the web app's
// semantic tokens (--bf-ct-* / --bg-base / --text-primary …), then the VS Code
// webview's tokens (--vscode-* / --bf-*), then a literal. The webview does NOT
// define the --bf-ct-*/--bg-base names, so before this chain the native <select>s
// fell through to `transparent`/`inherit` with no color-scheme and Chromium drew
// them as default LIGHT controls (white popup) in a dark editor. Resolving to the
// editor's --vscode-dropdown-* tokens fixes them in BOTH hosts, light AND dark.
const V = {
  border: 'var(--bf-ct-border, var(--border-subtle, var(--bf-border, var(--vscode-panel-border, rgba(148,163,184,0.3)))))',
  surface: 'var(--bf-ct-surface, var(--bg-elevated, var(--bf-surface, var(--vscode-editorWidget-background, transparent))))',
  surface2: 'var(--bf-ct-surface-2, var(--bg-base, var(--bf-surface-2, var(--vscode-textBlockQuote-background, transparent))))',
  // Form controls specifically prefer the editor's dropdown/input tokens so the
  // native <select> and its option list match VS Code's own dropdowns.
  field: 'var(--bf-ct-surface-2, var(--bg-base, var(--vscode-dropdown-background, var(--bf-surface, transparent))))',
  fieldText: 'var(--bf-ct-text, var(--text-primary, var(--vscode-dropdown-foreground, var(--bf-text, inherit))))',
  text: 'var(--bf-ct-text, var(--text-primary, var(--bf-text, inherit)))',
  text2: 'var(--bf-ct-text-2, var(--text-secondary, var(--bf-text, inherit)))',
  muted: 'var(--bf-ct-text-muted, var(--text-muted, var(--bf-text-muted, #6b7280)))',
  accent: 'var(--bf-ct-accent, var(--accent, var(--bf-accent, #3b82f6)))',
};

const S = {
  root: { margin: '4px 0 0', padding: '8px 10px', border: `1px solid ${V.border}`, borderRadius: 10, background: V.surface, display: 'flex', flexDirection: 'column', gap: 8 } as React.CSSProperties,
  muted: { fontSize: 12, color: V.muted } as React.CSSProperties,
  // Collapsible ticket-summary header — full-width, button-reset, subtle hover-less
  // affordance that carries a caret, an overall health ring and the linked count.
  ticketsHeader: { display: 'flex', alignItems: 'center', gap: 8, padding: '2px 4px', width: '100%', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', color: V.text } as React.CSSProperties,
  caret: { display: 'inline-block', fontSize: 11, color: V.muted, transition: 'transform 120ms ease' } as React.CSSProperties,
  ticketsCount: { fontSize: 12, fontWeight: 600, color: V.text } as React.CSSProperties,
  ticketsAgg: { fontSize: 11, color: V.muted } as React.CSSProperties,
  chip: { display: 'flex', alignItems: 'center', gap: 6, padding: '2px 6px', border: `1px solid ${V.border}`, borderRadius: 8 } as React.CSSProperties,
  ticketLabel: { fontSize: 12, fontWeight: 600, color: V.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as React.CSSProperties,
  // Clickable variant of the label — opens the artifact. Underlined-on-hover link
  // affordance, theme-driven accent, left-aligned and truncating like the span.
  ticketLink: { fontSize: 12, fontWeight: 600, color: V.accent, background: 'transparent', border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: 'underline', textUnderlineOffset: 2 } as React.CSSProperties,
  ticketMeta: { fontSize: 10, color: V.muted, textTransform: 'uppercase', letterSpacing: 0.4 } as React.CSSProperties,
  drawer: { fontSize: 12, color: V.text2, borderTop: `1px dashed ${V.border}`, paddingTop: 6 } as React.CSSProperties,
  section: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', borderTop: `1px dashed ${V.border}`, paddingTop: 8 } as React.CSSProperties,
  agentChip: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 8px', borderRadius: 999, background: V.surface2, border: `1px solid ${V.border}`, fontSize: 12, color: V.text } as React.CSSProperties,
  // `colorScheme` makes the browser draw the native <select> (and its OS/UA popup)
  // in the editor's active scheme even where the token background doesn't reach.
  select: { minWidth: 120, padding: '4px 8px', fontSize: 12, borderRadius: 8, border: `1px solid ${V.border}`, background: V.field, color: V.fieldText, colorScheme: 'inherit' } as React.CSSProperties,
  icon: { fontSize: 12, lineHeight: 1, padding: '2px 4px', cursor: 'pointer', background: 'transparent', border: 'none', color: V.muted } as React.CSSProperties,
  pill: (active: boolean): React.CSSProperties => ({
    fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 999, cursor: 'pointer',
    border: `1px solid ${active ? V.accent : V.border}`,
    background: active ? V.accent : V.surface2,
    color: active ? '#fff' : V.text2,
  }),
};
