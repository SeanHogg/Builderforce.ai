/**
 * meetingIntelligence — the AI half of live meetings (migration 0330).
 *
 * Two capabilities, both built on the persisted transcript
 * (`meeting_transcript_segments`):
 *
 *   1. runAgentTurn — a `cloud_agent`/`host_agent` attendee "speaks". Agents have
 *      no browser (they can't join the WebRTC mesh), so instead of a media track
 *      they contribute a spoken LINE: an LLM turn grounded in the meeting's kind +
 *      running transcript + the agent's own persona. The line is persisted, posted
 *      into the linked team chat, and BROADCAST over the media-room relay as an
 *      `agent-say` frame — connected clients caption it and speak it aloud (browser
 *      speechSynthesis / the tenant's cloned voice). This is the "caption/transcript
 *      bridge" that gives agents a real presence without terminating media server-side.
 *
 *   2. summarizeMeeting — post-meeting minutes. An LLM condenses the transcript into
 *      a short recap + decisions + action items, stored on the meeting and posted
 *      into the linked team chat as the durable attendance→minutes artifact.
 *
 * Both are best-effort and degrade honestly: no transcript → no summary; an LLM or
 * persona-resolve failure surfaces as an error the route maps to a 4xx/5xx, never a
 * fabricated line.
 */
import { asc, desc, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import {
  meetings, meetingTranscriptSegments, brainChatMessages, brainChats,
} from '../../infrastructure/database/schema';
import { ideProxy, readProxyChoice } from '../llm/LlmProxyService';
import { resolveWorkforceModel, WORKFORCE_MODEL_REF_PREFIX } from '../agent/agentPrompt';
import { broadcastRoom } from '../../infrastructure/relay/broadcastRoom';

type Meeting = typeof meetings.$inferSelect;
export type TranscriptSegment = typeof meetingTranscriptSegments.$inferSelect;

/** How many recent transcript lines to feed an agent turn (keeps the prompt bounded). */
const AGENT_CONTEXT_LINES = 40;
/** How many lines to summarize (a long meeting is truncated to the most recent). */
const SUMMARY_MAX_LINES = 400;

/** The media-relay room key a meeting's WebRTC + caption frames fan out through. */
export function mediaRoom(meeting: Pick<Meeting, 'roomKey'>): string {
  return `media:${meeting.roomKey}`;
}

/** ms since the meeting started — the transcript ordering key. */
export function elapsedMs(meeting: Pick<Meeting, 'startedAt'>): number {
  const started = meeting.startedAt?.getTime();
  return started ? Math.max(0, Date.now() - started) : 0;
}

/** Load a meeting's transcript in spoken order (oldest first). */
export async function loadTranscript(db: Db, meetingId: string, limit = SUMMARY_MAX_LINES): Promise<TranscriptSegment[]> {
  return db.select().from(meetingTranscriptSegments)
    .where(eq(meetingTranscriptSegments.meetingId, meetingId))
    .orderBy(asc(meetingTranscriptSegments.atMs), asc(meetingTranscriptSegments.createdAt))
    .limit(limit);
}

/**
 * Append a server-authored line into a brain team chat (assistant role, agent
 * attribution). Mirrors BrainService's write path: a monotonic per-chat `seq` and
 * a touch of `brain_chats.updatedAt`. Best-effort — never throws.
 */
export async function postMeetingChatLine(
  db: Db,
  chatId: number,
  content: string,
  authoredBy: { kind: string; ref: string; name: string },
): Promise<void> {
  try {
    const [last] = await db.select({ seq: brainChatMessages.seq }).from(brainChatMessages)
      .where(eq(brainChatMessages.chatId, chatId)).orderBy(desc(brainChatMessages.seq)).limit(1);
    await db.insert(brainChatMessages).values({
      chatId, role: 'assistant', content,
      metadata: JSON.stringify({ authoredBy }),
      seq: (last?.seq ?? 0) + 1,
    });
    await db.update(brainChats).set({ updatedAt: new Date() }).where(eq(brainChats.id, chatId));
  } catch { /* the meeting chat is a nice-to-have; never fail the turn on it */ }
}

/** Persist a transcript line + fan it out to live clients as a caption. */
export async function appendTranscriptLine(
  db: Db,
  env: Env,
  meeting: Meeting,
  line: { speakerRef: string; speakerName: string; speakerKind: 'human' | 'agent'; text: string; atMs?: number },
): Promise<TranscriptSegment | null> {
  const text = line.text.trim().slice(0, 2000);
  if (!text) return null;
  const atMs = line.atMs ?? elapsedMs(meeting);
  const [row] = await db.insert(meetingTranscriptSegments).values({
    tenantId: meeting.tenantId, meetingId: meeting.id,
    speakerRef: line.speakerRef, speakerName: line.speakerName, speakerKind: line.speakerKind,
    text, atMs,
  }).returning();
  // Fan out to REMOTE peers so they see the live caption on the speaker's tile.
  await broadcastRoom(env.CEREMONY_ROOM, mediaRoom(meeting), JSON.stringify({
    type: 'caption', ref: line.speakerRef, name: line.speakerName, kind: line.speakerKind, text,
  }));
  return row ?? null;
}

/**
 * An agent attendee takes a turn: an LLM speaks in-character, grounded in the
 * meeting so far. Returns the spoken text (empty if the model declined). The line
 * is persisted, broadcast as an `agent-say` frame (clients caption + voice it), and
 * logged into the linked team chat.
 */
export async function runAgentTurn(
  db: Db,
  env: Env,
  meeting: Meeting,
  agent: { ref: string; name: string },
  prompt?: string,
): Promise<{ text: string; atMs: number }> {
  const segments = await loadTranscript(db, meeting.id, AGENT_CONTEXT_LINES);
  const resolved = await resolveWorkforceModel(env, WORKFORCE_MODEL_REF_PREFIX + agent.ref, prompt ?? '').catch(() => null);
  const persona = resolved?.directives?.trim() || `You are ${agent.name}, an AI teammate on this team.`;
  const system = `${persona}

You are attending a live ${meeting.kind} meeting titled "${meeting.title}" as ${agent.name}. You are speaking OUT LOUD on a call: reply in 1-3 short spoken sentences — no markdown, no bullet lists, no headings, no emoji. Be concrete and useful; if you have nothing to add, say so briefly.`;

  const convo = segments.map((s) => `${s.speakerName}: ${s.text}`).join('\n');
  const ask = prompt?.trim()
    ? `A participant asks you directly: "${prompt.trim()}" — answer them.`
    : `It's your turn to speak. Give a brief, useful update or contribution for this ${meeting.kind}.`;
  const user = `${convo ? `Conversation so far:\n${convo}\n\n` : ''}${ask}`;

  const proxy = ideProxy(env);
  const result = await proxy.complete({
    model: resolved?.baseModel ?? undefined,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }] as never,
    temperature: resolved?.execParams?.temperature ?? 0.5,
    max_tokens: 220,
  });
  const { content } = await readProxyChoice(result);
  const text = (content ?? '').trim();
  if (!text) return { text: '', atMs: 0 };

  const atMs = elapsedMs(meeting);
  await db.insert(meetingTranscriptSegments).values({
    tenantId: meeting.tenantId, meetingId: meeting.id,
    speakerRef: agent.ref, speakerName: agent.name, speakerKind: 'agent', text, atMs,
  });
  await broadcastRoom(env.CEREMONY_ROOM, mediaRoom(meeting), JSON.stringify({
    type: 'agent-say', ref: agent.ref, name: agent.name, text, atMs,
  }));
  if (meeting.chatId != null) await postMeetingChatLine(db, meeting.chatId, text, { kind: 'agent', ref: agent.ref, name: agent.name });
  return { text, atMs };
}

/**
 * Generate meeting minutes from the transcript, store them on the meeting, and post
 * them into the linked team chat. Returns the summary text, or an error when there
 * is nothing to summarize / the model produced nothing.
 */
export async function summarizeMeeting(
  db: Db,
  env: Env,
  meeting: Meeting,
): Promise<{ summary: string } | { error: string }> {
  const segments = await loadTranscript(db, meeting.id, SUMMARY_MAX_LINES);
  if (segments.length === 0) return { error: 'No transcript to summarize yet.' };

  const convo = segments.map((s) => `${s.speakerName}: ${s.text}`).join('\n');
  const system = `You write concise, faithful meeting minutes. Given a raw transcript, produce short minutes in Markdown with, in order: a one-paragraph **Summary**; a **Decisions** section as a bullet list (omit the section entirely if there were none); and an **Action items** section as a checklist ("- [ ] Owner — task", omit if none). Only use what is in the transcript — never invent decisions, owners, or tasks.`;
  const user = `Meeting: "${meeting.title}" (${meeting.kind}).\n\nTranscript:\n${convo}`;

  const proxy = ideProxy(env);
  const result = await proxy.complete({
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }] as never,
    temperature: 0.3,
    max_tokens: 800,
  });
  const { content } = await readProxyChoice(result);
  const summary = (content ?? '').trim();
  if (!summary) return { error: 'Could not generate minutes.' };

  const now = new Date();
  await db.update(meetings).set({ summary, summaryGeneratedAt: now, updatedAt: now }).where(eq(meetings.id, meeting.id));
  if (meeting.chatId != null) {
    await postMeetingChatLine(db, meeting.chatId, `📝 **Meeting minutes — ${meeting.title}**\n\n${summary}`, { kind: 'agent', ref: 'meeting-notes', name: 'Meeting Notes' });
  }
  return { summary };
}
