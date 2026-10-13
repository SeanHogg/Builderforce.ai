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
import { resolveRunGate } from './runGate';
import { rollupChatTicketHealth } from '@builderforce/agent-loop';
import { useChatProgressSync } from './useChatProgressSync';
// The rail's ONE palette, shared with every part it composes (see tokens.ts).
import { V } from './tokens';
import { TicketParentLine } from './TicketParentLine';
import { AgentsSection } from './AgentsSection';
import { LinkForm } from './LinkForm';
import { MergeSection } from './MergeSection';
import { PeopleSection } from './PeopleSection';
import { QuestionsSection } from './QuestionsSection';
import { S } from './panelStyles';
import {
  RUNNABLE_KINDS,
  type ChatTicketsAdapter, type ChatTicketsLabels, type TicketKind,
  type TicketLinkVM, type ChatAgentVM, type ChatSubagentVM, type ChatMemberVM, type AgentOptionVM, type LineageVM, type ChatOptionVM, type ChatQuestionVM, type ChatTicketsExtension,
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
  /** Host-registered pills + drawers appended to the action row (see
   *  {@link ChatTicketsExtension}). Pass only the ones that currently have
   *  something to show; an empty/absent list adds nothing. */
  extensions?: ChatTicketsExtension[];
  /** The chat's LIVE sub-agents — runs its agents spawned, listed beside the invited
   *  agents so the roster names everyone working in the chat. The host knows them (the
   *  editor's run registry); omit where there are none. */
  subagents?: readonly ChatSubagentVM[];
}

/** The action-row drawers the panel ships with; extension keys must not collide. */
type BuiltinPanel = 'link' | 'agents' | 'people' | 'merge' | 'questions';

const RUNNABLE = new Set<TicketKind>(RUNNABLE_KINDS);

/** A chat can accumulate hundreds of linked tickets — auto-collapse the health-ring
 *  grid past this many so it doesn't push the composer off-screen. The user can still
 *  expand/collapse manually; once they do, we stop auto-deciding for this chat. */
const COLLAPSE_THRESHOLD = 8;

const NO_SUBAGENTS: readonly ChatSubagentVM[] = [];

function ChatTicketsPanelInner({ chatId, projectId, chatList, adapter, labels, onChanged, refreshSignal, visibility, onSetVisibility, onOpenTicket, extensions, subagents = NO_SUBAGENTS }: ChatTicketsPanelProps) {
  const [tickets, setTickets] = useState<TicketLinkVM[]>([]);
  const [agents, setAgents] = useState<ChatAgentVM[]>([]);
  const [members, setMembers] = useState<ChatMemberVM[]>([]);
  const [pool, setPool] = useState<AgentOptionVM[]>([]);
  const [questions, setQuestions] = useState<ChatQuestionVM[]>([]);
  // Which ONE drawer is open — a built-in key or a host extension's key.
  const [panel, setPanel] = useState<null | BuiltinPanel | string>(null);
  const togglePanel = (key: BuiltinPanel | string) => setPanel((open) => (open === key ? null : key));
  const openExtension = extensions?.find((ext) => ext.key === panel) ?? null;
  // An extension the host withdrew while its drawer was open (the tree went clean,
  // say) leaves `panel` pointing at nothing — fold the row back up instead.
  useEffect(() => {
    if (panel && !isBuiltinPanel(panel) && !extensions?.some((ext) => ext.key === panel)) setPanel(null);
  }, [panel, extensions]);
  const [lineageKey, setLineageKey] = useState<string | null>(null);
  const [lineage, setLineage] = useState<LineageVM[]>([]);
  const [runKey, setRunKey] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Collapse the ticket grid. `null` = "haven't decided yet" → auto-collapse a long
  // list on first load; a bool = the user chose, and we respect it from then on.
  const [collapsed, setCollapsed] = useState<boolean | null>(null);
  const userCollapsed = useRef(false);

  // The picker and Sessions tree show a chat-list snapshot; when the tickets read here
  // disagree with it, the host refetches so all three show one figure.
  const syncChatProgress = useChatProgressSync(chatId, chatList, onChanged);

  const load = useCallback(async () => {
    const [tk, ag, mem, qs] = await Promise.all([
      adapter.listTickets(chatId).catch(() => [] as TicketLinkVM[]),
      adapter.listAgents(chatId).catch(() => [] as ChatAgentVM[]),
      adapter.listMembers(chatId).catch(() => [] as ChatMemberVM[]),
      adapter.listQuestions(chatId).catch(() => [] as ChatQuestionVM[]),
    ]);
    setTickets(tk);
    syncChatProgress(tk);
    setAgents(ag);
    setMembers(mem);
    setQuestions(qs);
    // Auto-collapse a long list on first load; never override a user's own choice.
    if (!userCollapsed.current) setCollapsed(tk.length > COLLAPSE_THRESHOLD);
  }, [adapter, chatId, syncChatProgress]);

  useEffect(() => { void load(); }, [load, refreshSignal]);
  useEffect(() => { adapter.loadAgentPool().then(setPool).catch(() => setPool([])); }, [adapter]);

  const flash = (m: string) => { setMsg(m); if (typeof window !== 'undefined') window.setTimeout(() => setMsg(null), 3500); };
  const poolName = useCallback((ref: string) => pool.find((p) => p.ref === ref)?.name ?? ref, [pool]);

  /** This chat's OWN link row for a ticket's parent, when the chat is linked to the
   *  parent too — the common case, since the Brain links the epic it created as well
   *  as the children it hung under it. That real VM is what makes the chip's parent
   *  line clickable; a parent the chat does not link has no VM to route, so its line
   *  stays plain text rather than being routed through an invented health row. */
  const parentLink = useCallback((tk: TicketLinkVM): TicketLinkVM | undefined => (
    tk.parent ? tickets.find((t) => t.kind === tk.parent!.kind && t.ref === tk.parent!.ref) : undefined
  ), [tickets]);

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

  // Ask the host whether run dispatch is permitted (see resolveRunGate for why an
  // absent probe means "permitted" rather than "refuse").
  const runGate = resolveRunGate(adapter);

  const runTicket = async (tk: TicketLinkVM, agentRef: string) => {
    setBusy(true);
    try {
      const res = await adapter.runTicket(tk.kind, tk.ref, agentRef, chatId);
      flash(res.started ? labels.runStarted(res.agentName || poolName(agentRef)) : labels.runNoAgent);
      setRunKey(null);
      await load();
    } catch (e) {
      flash(e instanceof Error ? e.message : labels.runFailed);
    } finally { setBusy(false); }
  };

  // Roll the linked tickets up into one overall % for the collapsed header ring — the
  // SAME rollup the server puts on the chat list (see rollupChatTicketHealth for why it
  // weights `progressPct` rather than counting Σdone/Σtotal).
  const agg = useMemo(() => rollupChatTicketHealth(tickets), [tickets]);

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
      <div style={S.ticketGrid}>
        {tickets.length === 0 ? (
          <span style={S.muted}>{labels.none}</span>
        ) : tickets.map((tk) => {
          const key = `${tk.kind}:${tk.ref}`;
          const parentTk = parentLink(tk);
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
                {/* Which work item this ticket belongs to. Clickable only when the
                    parent is ALSO one of this chat's links, so the host is handed a
                    real TicketLinkVM rather than a fabricated health row. */}
                <TicketParentLine
                  parent={tk.parent}
                  inParent={labels.inParent}
                  openTitle={labels.open}
                  onOpen={onOpenTicket && parentTk ? () => onOpenTicket(parentTk) : undefined}
                />
              </div>
              <div style={{ display: 'flex', gap: 2 }}>
                {onOpenTicket && tk.exists && (
                  <button type="button" title={`${labels.open} · ${tk.label}`} onClick={() => onOpenTicket(tk)} style={S.icon}>↗</button>
                )}
                {RUNNABLE.has(tk.kind) && tk.exists && (
                  <button
                    type="button"
                    // Disabled + explained, not hidden: a viewer should see that
                    // running exists and why they can't, matching every other
                    // dispatch control. Previously this always looked live and
                    // failed at click time with a role error.
                    disabled={!runGate.allowed}
                    aria-disabled={!runGate.allowed}
                    title={runGate.allowed ? labels.run : (runGate.reason ?? labels.run)}
                    onClick={() => setRunKey(runKey === key ? null : key)}
                    style={runGate.allowed ? S.icon : { ...S.icon, opacity: 0.45, cursor: 'not-allowed' }}
                  >▶</button>
                )}
                <button type="button" title={labels.lineage} onClick={() => void openLineage(tk)} style={S.icon}>⑃</button>
                <button type="button" title={labels.unlink} disabled={busy} onClick={() => void unlink(tk)} style={S.icon}>✕</button>
              </div>
              {runKey === key && (
                <select aria-label={labels.pickAgent} value="" onChange={(e) => { if (e.target.value) void runTicket(tk, e.target.value); }} style={S.select}>
                  <option style={S.option} value="">{labels.pickAgent}</option>
                  {agents.map((a) => <option style={S.option} key={a.id} value={a.agentRef}>★ {poolName(a.agentRef)}</option>)}
                  {pool.filter((p) => !agents.some((a) => a.agentRef === p.ref)).map((p) => <option style={S.option} key={p.ref} value={p.ref}>{p.name}</option>)}
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
        <button type="button" onClick={() => togglePanel('link')} style={S.pill(panel === 'link')}>＋ {labels.link}</button>
        <button type="button" onClick={() => togglePanel('agents')} style={S.pill(panel === 'agents')}>👥 {labels.agents}{agents.length + subagents.length ? ` (${agents.length + subagents.length})` : ''}</button>
        <button type="button" onClick={() => togglePanel('people')} style={S.pill(panel === 'people')}>👤 {labels.people}{members.length ? ` (${members.length})` : ''}</button>
        <button type="button" onClick={() => togglePanel('merge')} style={S.pill(panel === 'merge')}>⧉ {labels.merge}</button>
        {questions.length > 0 && <button type="button" onClick={() => togglePanel('questions')} style={S.pill(panel === 'questions')}>❓ {labels.questions} ({questions.length})</button>}
        {extensions?.map((ext) => (
          <button
            key={ext.key}
            type="button"
            title={ext.title ?? ext.label}
            aria-label={ext.title ?? ext.label}
            aria-expanded={panel === ext.key}
            onClick={() => togglePanel(ext.key)}
            style={S.pill(panel === ext.key)}
          >
            {ext.icon ? `${ext.icon} ` : ''}{ext.label}{ext.count ? ` (${ext.count})` : ''}
          </button>
        ))}
        {msg && <span style={{ fontSize: 12, color: V.accent, alignSelf: 'center' }}>{msg}</span>}
      </div>

      {openExtension && <div style={S.drawer}>{openExtension.render()}</div>}

      {panel === 'link' && <LinkForm search={adapter.searchTickets} projectId={projectId} existing={tickets} labels={labels} onLink={async (kind, ref, linkType) => {
        try { await adapter.linkTicket(chatId, { kind, ref, linkType }); await load(); }
        catch (e) { flash(e instanceof Error ? e.message : labels.linkFailed); }
      }} />}

      {panel === 'agents' && <AgentsSection agents={agents} subagents={subagents} pool={pool} labels={labels}
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

      {panel === 'questions' && <QuestionsSection questions={questions} labels={labels}
        onAnswer={async (id, answer) => { await adapter.answerQuestion(id, answer); await load(); onChanged?.(); }} />}
    </div>
  );
}

const BUILTIN_PANELS: ReadonlySet<string> = new Set<BuiltinPanel>(['link', 'agents', 'people', 'merge', 'questions']);
function isBuiltinPanel(key: string): key is BuiltinPanel { return BUILTIN_PANELS.has(key); }

/**
 * Memoized: this panel sits directly under the composer, so it would otherwise
 * reconcile its whole subtree (health-ring SVGs, selects, link/merge/agents forms)
 * on every keystroke and streaming token. Callers must pass referentially stable
 * props (memoize `chatList` and `onChanged`) for the memo to take effect.
 */
export const ChatTicketsPanel = memo(ChatTicketsPanelInner);
