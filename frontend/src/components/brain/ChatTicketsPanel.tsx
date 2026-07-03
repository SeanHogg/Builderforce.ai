'use client';

/**
 * ChatTicketsPanel — ties a Brain chat to work items and surfaces their health.
 *
 * Under a chat's header it shows: a health ring (% done) for every linked ticket
 * of any tier (portfolio · objective/OKR · initiative · epic · task); controls to
 * link/unlink a ticket; the chat↔ticket lineage (which chats a ticket came from);
 * a "merge into this chat" consolidator; and an agent roster where a teammate
 * agent can be invited as a participant OR tagged to EXECUTE a linked task/epic.
 *
 * All data flows through the shared `brain.*` API (same endpoints the MCP tools
 * use) so behaviour is identical however the chat is driven. Themed via CSS vars
 * (light + dark) and localized through the `brain` catalog namespace.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { HealthRing } from '@seanhogg/builderforce-brain-ui';
import { ThemeSelect } from '@/components/ThemeSelect';
import {
  brain, tasksApi,
  type BrainChat, type ChatTicketLink, type ChatAgentInvite, type LinkedChatRef, type TicketKind, type Task,
} from '@/lib/builderforceApi';
import { loadAgentPool, type PoolAgent } from '@/lib/agentPool';

const KINDS: TicketKind[] = ['task', 'epic', 'objective', 'initiative', 'portfolio'];
const RUNNABLE = new Set<TicketKind>(['task', 'epic']);

export function ChatTicketsPanel({ chatId, projectId, chatList, onChanged }: {
  chatId: number;
  projectId: number | null;
  chatList: BrainChat[];
  onChanged?: () => void;
}) {
  const t = useTranslations('brain.tickets');
  const [tickets, setTickets] = useState<ChatTicketLink[]>([]);
  const [agents, setAgents] = useState<ChatAgentInvite[]>([]);
  const [pool, setPool] = useState<PoolAgent[]>([]);
  const [panel, setPanel] = useState<null | 'link' | 'agents' | 'merge'>(null);
  const [lineageFor, setLineageFor] = useState<string | null>(null);
  const [lineage, setLineage] = useState<LinkedChatRef[]>([]);
  const [runFor, setRunFor] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [tk, ag] = await Promise.all([
      brain.listChatTickets(chatId).catch(() => [] as ChatTicketLink[]),
      brain.listChatAgents(chatId).catch(() => [] as ChatAgentInvite[]),
    ]);
    setTickets(tk);
    setAgents(ag);
  }, [chatId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { loadAgentPool().then(setPool).catch(() => setPool([])); }, []);

  const flash = (m: string) => { setMsg(m); window.setTimeout(() => setMsg(null), 3500); };
  const poolName = useCallback((ref: string) => pool.find((p) => p.ref === ref)?.name ?? ref, [pool]);

  const unlink = async (tk: ChatTicketLink) => {
    setBusy(true);
    try { await brain.unlinkChatTicket(chatId, tk.kind, tk.ref); await load(); } finally { setBusy(false); }
  };

  const openLineage = async (tk: ChatTicketLink) => {
    if (lineageFor === `${tk.kind}:${tk.ref}`) { setLineageFor(null); return; }
    setLineageFor(`${tk.kind}:${tk.ref}`);
    setLineage(await brain.listTicketChats(tk.kind, tk.ref).catch(() => []));
  };

  const runTicket = async (tk: ChatTicketLink, agentRef: string) => {
    setBusy(true);
    try {
      // Ensure the agent is a participant, assign it to the ticket, then start a
      // run — reuses the board's dispatch (assignee + run-now) so nothing forks.
      await brain.inviteChatAgent(chatId, { agentRef }).catch(() => {});
      await tasksApi.update(Number(tk.ref), { assignedAgentRef: agentRef });
      const res = await tasksApi.runNow(Number(tk.ref));
      flash(res.executionId ? t('runStarted', { agent: poolName(agentRef) }) : t('runNoAgent'));
      setRunFor(null);
      await load();
    } catch (e) {
      flash(e instanceof Error ? e.message : t('runFailed'));
    } finally { setBusy(false); }
  };

  return (
    <div style={{ margin: '4px 12px 0', padding: '8px 10px', border: '1px solid var(--border-subtle)', borderRadius: 10, background: 'var(--bg-elevated, var(--surface))', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Linked-ticket health rings */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        {tickets.length === 0 ? (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('none')}</span>
        ) : tickets.map((tk) => {
          const key = `${tk.kind}:${tk.ref}`;
          return (
            <div key={tk.linkId} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 6px', border: '1px solid var(--border-subtle)', borderRadius: 8 }}>
              <HealthRing percent={tk.progressPct} size={36} caption={tk.total > 0 ? `${tk.done}/${tk.total}` : undefined} muted={!tk.exists} ariaLabel={t('ringAria', { pct: tk.progressPct, label: tk.label })} />
              <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, maxWidth: 160 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={tk.label}>{tk.label}</span>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
                  {t(`kind.${tk.kind}`)} · {tk.status}{tk.linkType === 'created' ? ` · ${t('spawned')}` : ''}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 2 }}>
                {RUNNABLE.has(tk.kind) && tk.exists && (
                  <button type="button" title={t('run')} onClick={() => setRunFor(runFor === key ? null : key)} style={iconBtn}>▶</button>
                )}
                <button type="button" title={t('lineage')} onClick={() => void openLineage(tk)} style={iconBtn}>⑃</button>
                <button type="button" title={t('unlink')} disabled={busy} onClick={() => void unlink(tk)} style={iconBtn}>✕</button>
              </div>
              {runFor === key && (
                <div style={{ position: 'relative' }}>
                  <ThemeSelect
                    ariaLabel={t('pickAgent')}
                    value=""
                    onChange={(v) => { if (v) void runTicket(tk, v); }}
                    options={[
                      { value: '', label: t('pickAgent') },
                      ...agents.map((a) => ({ value: a.agentRef, label: `★ ${poolName(a.agentRef)}` })),
                      ...pool.filter((p) => !agents.some((a) => a.agentRef === p.ref)).map((p) => ({ value: p.ref, label: p.name })),
                    ]}
                    style={{ minWidth: 150, padding: '3px 6px', fontSize: 12 }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Lineage drawer */}
      {lineageFor && (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', borderTop: '1px dashed var(--border-subtle)', paddingTop: 6 }}>
          <strong style={{ color: 'var(--text-primary)' }}>{t('lineageTitle')}</strong>
          {lineage.length === 0 ? <span style={{ marginLeft: 8, color: 'var(--text-muted)' }}>{t('lineageEmpty')}</span> : (
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
              {lineage.map((c) => (
                <li key={c.chatId} style={{ marginBottom: 2 }}>
                  <span style={{ fontWeight: c.chatId === chatId ? 700 : 400 }}>{c.title}</span>
                  {c.linkType === 'created' ? <em style={{ color: 'var(--accent)', marginLeft: 6 }}>{t('spawned')}</em> : null}
                  {c.isArchived ? <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>({t('merged')})</span> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Action toggles */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => setPanel(panel === 'link' ? null : 'link')} style={pillBtn(panel === 'link')}>＋ {t('link')}</button>
        <button type="button" onClick={() => setPanel(panel === 'agents' ? null : 'agents')} style={pillBtn(panel === 'agents')}>👥 {t('agents')} {agents.length ? `(${agents.length})` : ''}</button>
        <button type="button" onClick={() => setPanel(panel === 'merge' ? null : 'merge')} style={pillBtn(panel === 'merge')}>⧉ {t('merge')}</button>
        {msg && <span style={{ fontSize: 12, color: 'var(--accent)', alignSelf: 'center' }}>{msg}</span>}
      </div>

      {panel === 'link' && <LinkForm chatId={chatId} projectId={projectId} existing={tickets} onDone={async () => { await load(); }} onFlash={flash} />}
      {panel === 'agents' && (
        <AgentsSection
          chatId={chatId}
          agents={agents}
          pool={pool}
          onChanged={load}
        />
      )}
      {panel === 'merge' && (
        <MergeSection
          chatId={chatId}
          chatList={chatList}
          onMerged={async (n) => { flash(t('mergedN', { n })); await load(); onChanged?.(); }}
        />
      )}
    </div>
  );
}

// ── Link a ticket ────────────────────────────────────────────────────────────

function LinkForm({ chatId, projectId, existing, onDone, onFlash }: {
  chatId: number; projectId: number | null; existing: ChatTicketLink[];
  onDone: () => Promise<void>; onFlash: (m: string) => void;
}) {
  const t = useTranslations('brain.tickets');
  const [kind, setKind] = useState<TicketKind>('task');
  const [ref, setRef] = useState('');
  const [linkType, setLinkType] = useState<'linked' | 'created'>('linked');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Load the tasks/epics for the chat's project (or all) to power the picker.
    tasksApi.list(projectId ?? undefined).then(setTasks).catch(() => setTasks([]));
  }, [projectId]);

  const taskOptions = useMemo(() =>
    tasks.filter((tk) => (kind === 'epic' ? tk.taskType === 'epic' : tk.taskType !== 'epic'))
      .filter((tk) => !existing.some((e) => e.kind === kind && e.ref === String(tk.id)))
      .map((tk) => ({ value: String(tk.id), label: `${tk.key} — ${tk.title}` })),
  [tasks, kind, existing]);

  const submit = async () => {
    if (!ref.trim()) return;
    setBusy(true);
    try {
      await brain.linkChatTicket(chatId, { kind, ref: ref.trim(), linkType });
      setRef('');
      await onDone();
    } catch (e) {
      onFlash(e instanceof Error ? e.message : t('linkFailed'));
    } finally { setBusy(false); }
  };

  const isTaskKind = kind === 'task' || kind === 'epic';

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', borderTop: '1px dashed var(--border-subtle)', paddingTop: 8 }}>
      <ThemeSelect
        ariaLabel={t('kindLabel')}
        value={kind}
        onChange={(v) => { setKind(v as TicketKind); setRef(''); }}
        options={KINDS.map((k) => ({ value: k, label: t(`kind.${k}`) }))}
        style={{ minWidth: 120, padding: '4px 8px', fontSize: 12 }}
      />
      {isTaskKind ? (
        <ThemeSelect
          ariaLabel={t('pickTicket')}
          value={ref}
          onChange={setRef}
          options={[{ value: '', label: t('pickTicket') }, ...taskOptions]}
          style={{ minWidth: 200, padding: '4px 8px', fontSize: 12 }}
        />
      ) : (
        <input
          value={ref}
          onChange={(e) => setRef(e.target.value)}
          placeholder={t('refPlaceholder')}
          style={{ minWidth: 220, padding: '5px 8px', fontSize: 12, borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-primary)' }}
        />
      )}
      <ThemeSelect
        ariaLabel={t('linkTypeLabel')}
        value={linkType}
        onChange={(v) => setLinkType(v as 'linked' | 'created')}
        options={[{ value: 'linked', label: t('linkTypeLinked') }, { value: 'created', label: t('linkTypeCreated') }]}
        style={{ minWidth: 130, padding: '4px 8px', fontSize: 12 }}
      />
      <button type="button" onClick={() => void submit()} disabled={busy || !ref.trim()} style={pillBtn(true)}>{busy ? '…' : t('linkAction')}</button>
    </div>
  );
}

// ── Agents in the chat ───────────────────────────────────────────────────────

function AgentsSection({ chatId, agents, pool, onChanged }: {
  chatId: number; agents: ChatAgentInvite[]; pool: PoolAgent[]; onChanged: () => Promise<void>;
}) {
  const t = useTranslations('brain.tickets');
  const [busy, setBusy] = useState(false);
  const poolName = (ref: string) => pool.find((p) => p.ref === ref)?.name ?? ref;
  const uninvited = pool.filter((p) => !agents.some((a) => a.agentRef === p.ref));

  const invite = async (ref: string) => {
    const kind = pool.find((p) => p.ref === ref)?.kind ?? 'workforce';
    setBusy(true);
    try { await brain.inviteChatAgent(chatId, { agentRef: ref, agentKind: kind }); await onChanged(); } finally { setBusy(false); }
  };
  const remove = async (a: ChatAgentInvite) => {
    setBusy(true);
    try { await brain.removeChatAgent(chatId, a.id); await onChanged(); } finally { setBusy(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px dashed var(--border-subtle)', paddingTop: 8 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {agents.length === 0 ? <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('noAgents')}</span> : agents.map((a) => (
          <span key={a.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 8px', borderRadius: 999, background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', fontSize: 12 }}>
            <span aria-hidden>🤖</span>{poolName(a.agentRef)}
            <button type="button" title={t('removeAgent')} disabled={busy} onClick={() => void remove(a)} style={{ ...iconBtn, fontSize: 11 }}>✕</button>
          </span>
        ))}
      </div>
      <ThemeSelect
        ariaLabel={t('inviteAgent')}
        value=""
        onChange={(v) => { if (v) void invite(v); }}
        options={[{ value: '', label: t('inviteAgent') }, ...uninvited.map((p) => ({ value: p.ref, label: `${p.name} — ${p.meta}` }))]}
        style={{ maxWidth: 260, padding: '4px 8px', fontSize: 12 }}
      />
      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('agentsHint')}</span>
    </div>
  );
}

// ── Merge (consolidate) chats ────────────────────────────────────────────────

function MergeSection({ chatId, chatList, onMerged }: {
  chatId: number; chatList: BrainChat[]; onMerged: (n: number) => Promise<void>;
}) {
  const t = useTranslations('brain.tickets');
  const [selected, setSelected] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const candidates = chatList.filter((c) => c.id !== chatId);

  const toggle = (id: number) => setSelected((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);

  const merge = async () => {
    if (selected.length === 0) return;
    setBusy(true);
    try { await brain.consolidateChats(chatId, selected); setSelected([]); await onMerged(selected.length); } finally { setBusy(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px dashed var(--border-subtle)', paddingTop: 8 }}>
      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t('mergeHint')}</span>
      <div style={{ maxHeight: 160, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {candidates.length === 0 ? <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('mergeNoOthers')}</span> : candidates.map((c) => (
          <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '3px 4px', cursor: 'pointer' }}>
            <input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggle(c.id)} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</span>
          </label>
        ))}
      </div>
      <button type="button" onClick={() => void merge()} disabled={busy || selected.length === 0} style={pillBtn(true)}>
        {busy ? '…' : t('mergeAction', { n: selected.length })}
      </button>
    </div>
  );
}

// ── shared inline styles (theme-var driven) ──────────────────────────────────

const iconBtn: React.CSSProperties = {
  fontSize: 12, lineHeight: 1, padding: '2px 4px', cursor: 'pointer',
  background: 'transparent', border: 'none', color: 'var(--text-muted)',
};

function pillBtn(active: boolean): React.CSSProperties {
  return {
    fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 999, cursor: 'pointer',
    border: `1px solid ${active ? 'var(--accent)' : 'var(--border-subtle)'}`,
    background: active ? 'var(--accent)' : 'var(--bg-base)',
    color: active ? '#fff' : 'var(--text-secondary)',
  };
}
