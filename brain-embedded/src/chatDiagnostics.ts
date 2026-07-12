/**
 * chatDiagnostics — a pure serializer for the "Copy diagnostics" action.
 *
 * The plain transcript (turns + tool I/O) answers "what did the model say?"; this
 * answers "what STATE was this chat in?" — the identity + wiring facts you otherwise
 * have to guess at from screenshots: the chat's own project, the tenant, the project
 * Evermind head (version / mode / learned / queued / last-learned), the learn-gate
 * outcome for the last turn, the agents invited into the chat, and the linked tickets.
 *
 * It is the fix for a whole class of "even after N fixes I can't tell what's wrong"
 * loops: the #1 real cause of "Learning · Connected yet nothing learns" is that the
 * CHAT is bound to a different project (or none) than the panel shows — a fact invisible
 * in the UI but dumped plainly here, with a Signals section that names the likely cause.
 *
 * Pure + host-agnostic (no fetch, no DOM): every surface gathers the data its own way
 * and calls this ONE renderer, so the copied report is identical on web and in VS Code.
 */

/** The project Evermind head/activity snapshot, as the panel reads it. */
export interface ChatDiagnosticsEvermind {
  version: number;
  mode: string;
  inferenceEnabled?: boolean;
  teacherModel?: string | null;
  /** Merged contributions to date — the panel's "Learned". */
  contributions?: number;
  /** Queued-but-not-yet-merged contributions — the panel's "Queued". */
  pending?: number;
  /** ISO timestamp of the last merge, or null if never — the panel's "Last learned". */
  lastLearnedAt?: string | null;
}

/** Everything the diagnostics block needs — already gathered by the host (pure in). */
export interface ChatDiagnosticsData {
  surface?: string;
  chatId?: number | null;
  chatTitle?: string | null;
  /** 'shared' | 'locked' — who can see the chat. */
  chatVisibility?: string | null;
  /** The chat's OWN project (what the learn gate keys on), or null when unattached. */
  projectId?: number | null;
  projectName?: string | null;
  /** The project the surrounding UI/panel is showing, when it differs from the chat's. */
  selectedProjectId?: number | null;
  tenantId?: number | string | null;
  userId?: string | null;
  /** The project Evermind head for the CHAT's project (not the selected one). */
  evermind?: ChatDiagnosticsEvermind | null;
  /** The server learn-gate outcome for the most recent assistant turn, if known. */
  lastLearn?: { learned: boolean; version: number; reason?: string | null } | null;
  agents?: Array<{ agentRef: string; role: string }>;
  tickets?: Array<{ kind: string; ref: string; label?: string; linkType?: string; status?: string }>;
}

function fmtProject(id: number | null | undefined, name?: string | null): string {
  if (id == null) return 'none';
  return name ? `${name} (#${id})` : `#${id}`;
}

/**
 * Compute the actionable "why isn't this working?" signals from the raw facts, so the
 * report NAMES the likely cause instead of leaving the reader to correlate numbers.
 * Ordered most-actionable first. Returns [] when nothing is obviously wrong.
 */
function diagnosticsSignals(d: ChatDiagnosticsData): string[] {
  const out: string[] = [];
  const ev = d.evermind;

  // #1 real cause: the chat isn't bound to a project (the learn gate keys on the
  // CHAT's projectId, not the panel's selected project).
  if (d.projectId == null || d.lastLearn?.reason === 'not-attached') {
    out.push(
      '⚠️ Chat is NOT attached to a project (chat.projectId is null). The learn gate keys on the CHAT\'s project, so this chat contributes NOTHING to any Evermind — even though the panel shows the selected project as connected. Attach the chat to a project (or re-open it so the self-heal adopts the active project).',
    );
  } else if (d.selectedProjectId != null && d.selectedProjectId !== d.projectId) {
    out.push(
      `⚠️ Chat's project (#${d.projectId}) differs from the panel's selected project (#${d.selectedProjectId}). The Evermind panel reflects the SELECTED project; this chat feeds project #${d.projectId}. They are different models — compare the versions below.`,
    );
  }

  if (ev && ev.version < 1) {
    out.push(
      `⚠️ The chat's project Evermind is UNSEEDED (v0). Until a base model is seeded (version ≥ 1) the gate returns "not-seeded" and no turn contributes. This is why a learn step can report v0.`,
    );
  }
  if (ev && ev.version >= 1 && ev.mode !== 'connected') {
    out.push(`⚠️ The chat's project Evermind is "${ev.mode}" (not connected) — read-only, so turns don't contribute.`);
  }
  if (d.lastLearn && d.lastLearn.learned && ev && ev.version >= 1 && d.lastLearn.version !== ev.version) {
    out.push(
      `⚠️ Last turn reported learn version v${d.lastLearn.version} but the chat's project head is v${ev.version}. A version mismatch means the learn step and the panel are resolving DIFFERENT projects/heads.`,
    );
  }
  if ((d.agents?.length ?? 0) === 0) {
    out.push('ℹ️ No agents are invited into this chat (chats.list_agents is empty), so dispatched agents post nothing back here.');
  }
  return out;
}

/**
 * Render the diagnostics block as Markdown lines (no trailing blank line). Every field
 * is best-effort: an absent value is shown as "unknown"/"none" rather than omitted, so
 * the reader can tell "not gathered" from "genuinely empty".
 */
export function formatChatDiagnostics(d: ChatDiagnosticsData): string[] {
  const lines: string[] = ['## Chat diagnostics'];
  if (d.surface) lines.push(`- Surface: ${d.surface}`);
  lines.push(`- Chat: ${d.chatTitle?.trim() ? `"${d.chatTitle.trim()}"` : 'Untitled'}${d.chatId != null ? ` (#${d.chatId})` : ''}${d.chatVisibility ? ` · ${d.chatVisibility}` : ''}`);
  lines.push(`- Chat's project: ${fmtProject(d.projectId, d.projectName)}`);
  if (d.selectedProjectId != null && d.selectedProjectId !== d.projectId) {
    lines.push(`- Panel's selected project: #${d.selectedProjectId}`);
  }
  lines.push(`- Tenant: ${d.tenantId != null ? `#${d.tenantId}` : 'unknown'} · User: ${d.userId ?? 'unknown'}`);

  const ev = d.evermind;
  if (ev) {
    lines.push(
      `- Evermind (chat's project): v${ev.version} · ${ev.mode}`
        + `${ev.inferenceEnabled != null ? ` · inference ${ev.inferenceEnabled ? 'on' : 'off'}` : ''}`
        + ` · teacher ${ev.teacherModel ? ev.teacherModel : 'none'}`
        + `${ev.contributions != null ? ` · Learned ${ev.contributions}` : ''}`
        + `${ev.pending != null ? ` · Queued ${ev.pending}` : ''}`
        + ` · Last learned ${ev.lastLearnedAt ? ev.lastLearnedAt : 'never'}`,
    );
  } else {
    lines.push(`- Evermind (chat's project): not resolved (no project, or head unavailable)`);
  }

  if (d.lastLearn) {
    lines.push(
      `- Last turn learn gate: learned=${d.lastLearn.learned}`
        + ` · reported v${d.lastLearn.version}`
        + `${d.lastLearn.reason ? ` · reason=${d.lastLearn.reason}` : ''}`,
    );
  } else {
    lines.push('- Last turn learn gate: unknown (no assistant turn carried a learn outcome)');
  }

  const agents = d.agents ?? [];
  lines.push(`- Agents in chat (${agents.length})${agents.length ? ': ' + agents.map((a) => `${a.agentRef} (${a.role})`).join(', ') : ''}`);

  const tickets = d.tickets ?? [];
  if (tickets.length) {
    lines.push(`- Linked tickets (${tickets.length}):`);
    for (const tk of tickets) {
      lines.push(`  - ${tk.kind} #${tk.ref}${tk.label ? ` "${tk.label}"` : ''}${tk.linkType || tk.status ? ` [${[tk.linkType, tk.status].filter(Boolean).join(', ')}]` : ''}`);
    }
  } else {
    lines.push('- Linked tickets (0)');
  }

  const signals = diagnosticsSignals(d);
  if (signals.length) {
    lines.push('', '### Signals');
    for (const s of signals) lines.push(`- ${s}`);
  }
  return lines;
}
