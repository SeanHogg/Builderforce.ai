/**
 * chatRunMilestones — the runtime's chat-awareness hook: a cloud-agent run narrates
 * its lifecycle (started ▸ paused ▸ resumed ▸ completed / failed / cancelled) into
 * every Brain chat its ticket is linked to.
 */
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { resolveAgentDisplayName } from './agentDisplayNames';
import { joinAgentToChat } from './chatAgents';
import { postSystemMessage } from './chatSystemMessage';
import type { ChatTicketDeps } from './chatTicketAccess';
import { isTicketKind, type RunMilestonePhase } from './chatTicketTypes';
import { listChatsForTicket } from './ticketChatLineage';

const SOURCE = 'application/brain/chatRunMilestones.ts';

export interface RunMilestoneInput {
  kind: string; ref: string; agentRef?: string | null;
  phase: RunMilestonePhase; executionId: number;
  toStatus?: string | null; resultText?: string | null; errorMessage?: string | null; agentName?: string;
  /** The `ask_human` question a `paused` milestone narrates, so the human sees WHAT
   *  the agent is blocked on in the chat itself (not just that it is blocked). */
  questionText?: string | null;
  /** Disambiguates REPEATABLE phases (`paused`/`resumed` can occur once per
   *  question cycle) inside the per-execution+phase idempotency key — pass the
   *  approval id so each Q&A cycle narrates exactly once. Single-shot phases omit it. */
  eventNonce?: string | null;
}

/** First non-empty line of a run result/error, trimmed of control tokens + capped. */
function firstLine(s?: string | null): string {
  if (!s) return '';
  const line = s.replace(/\[auto-approve\]/g, '').split('\n').map((x) => x.trim()).find(Boolean) ?? '';
  return line.length > 240 ? `${line.slice(0, 240)}…` : line;
}

/** Human line for a run milestone. */
function runMilestoneText(
  name: string, kind: string, ref: string,
  input: { phase: RunMilestonePhase; toStatus?: string | null; resultText?: string | null; errorMessage?: string | null; questionText?: string | null },
): string {
  if (input.phase === 'started') return `▶️ **${name}** started working on ${kind} #${ref}.`;
  if (input.phase === 'completed') {
    const lane = input.toStatus ? ` — moved to **${input.toStatus.replace(/_/g, ' ')}**` : '';
    const note = firstLine(input.resultText);
    return `✅ **${name}** finished ${kind} #${ref}${lane}.${note ? ` ${note}` : ''}`;
  }
  // Paused (ask_human), resumed, and cancelled bypass RuntimeService.update, so these are
  // posted from the direct-write sites — full-lifecycle narration, not just start/finish/fail.
  if (input.phase === 'paused') {
    const q = firstLine(input.questionText);
    return q
      ? `🙋 **${name}** paused on ${kind} #${ref} — needs a human answer: ${q}`
      : `🙋 **${name}** paused on ${kind} #${ref} — waiting on a human answer to continue.`;
  }
  if (input.phase === 'resumed') return `▶️ **${name}** resumed work on ${kind} #${ref} — a human answered its question.`;
  if (input.phase === 'cancelled') return `⏹️ **${name}**'s run on ${kind} #${ref} was cancelled.`;
  const why = firstLine(input.errorMessage);
  return `⚠️ **${name}**'s run on ${kind} #${ref} failed.${why ? ` ${why}` : ''}`;
}

/**
 * Post a run MILESTONE for a ticket into every Brain chat it is linked to — the runtime's
 * hook so a cloud-agent run narrates its progress back into the conversation that spawned
 * the work (started ▸ completed ▸ failed). Tenant-scoped + system-driven, fanned out via
 * {@link listChatsForTicket}. Per-execution + per-phase IDEMPOTENT (a retried lifecycle
 * event never double-posts). Best-effort — never throws to the caller (a run's chat
 * narration must not be able to break the run). This closes the "runtime has no chat
 * awareness" gap: dev agents now report progress in the chat as they work.
 */
export async function postRunMilestone(deps: ChatTicketDeps, tenantId: number, input: RunMilestoneInput): Promise<void> {
  try {
    const { kind, ref, phase, executionId } = input;
    if (!ref || !isTicketKind(kind)) return;
    const chats = (await listChatsForTicket(deps.db, tenantId, kind, ref))
      .filter((c) => !c.isArchived && c.mergedIntoChatId == null);
    if (chats.length === 0) return;
    const name = input.agentName
      ?? (input.agentRef ? await resolveAgentDisplayName(deps.db, tenantId, input.agentRef) : 'The agent');
    const key = `${executionId}:${phase}${input.eventNonce ? `:${input.eventNonce}` : ''}`;
    const text = runMilestoneText(name, kind, ref, input);
    // Everything a client needs to RE-COMPOSE this line in its own language: who, which
    // ticket, which phase, the lane it moved to, and the one line of result/error worth
    // showing. `text` remains the English fallback for rows written before this
    // contract and for any surface that has no activity renderer.
    const lane = phase === 'completed' && input.toStatus ? input.toStatus.replace(/_/g, ' ') : null;
    const note = phase === 'completed'
      ? firstLine(input.resultText)
      : (phase === 'failed' ? firstLine(input.errorMessage) : '');
    const question = phase === 'paused' ? firstLine(input.questionText) : '';
    // An agent that narrates into a chat IS in that chat. The run's agent comes from lane
    // staffing / the managed producer role, which is often NOT the ticket's
    // `assignedAgentRef` — so the assignment-time handoff never joined it, and the chat
    // showed "Bob started working…" while its Agents list named only the ticket owner.
    // Joined silently: the milestone line itself is the announcement.
    const agentRef = input.agentRef;
    if (agentRef) {
      await Promise.all(chats.map((c) => joinAgentToChat(deps, tenantId, c.chatId, agentRef).catch((error) => {
        reportCaughtError(error, { source: SOURCE, operation: "postRunMilestone.joinAgentToChat" });
      })));
    }
    await Promise.all(chats.map((c) => postSystemMessage(deps.db, deps.env, tenantId, c.chatId, text, {
        runMilestone: key, ticketKind: kind, ticketRef: ref, phase, executionId, agentRef: input.agentRef ?? null,
        agentName: name,
        ...(lane ? { toStatus: lane } : {}),
        ...(note ? { note } : {}),
        ...(question ? { question } : {}),
      }, `run:${key}`)));
  } catch (error) {
    // Narration remains best-effort, but delivery failures must be observable.
    reportCaughtError(error, { source: SOURCE, operation: "postRunMilestone", context: { logMessage: '[brain:run-milestone] publish failed', details: {
      tenantId, executionId: input.executionId, phase: input.phase,
      ticketKind: input.kind, ticketRef: input.ref,
      error: error instanceof Error ? error.message : String(error),
    } } });
  }
}
