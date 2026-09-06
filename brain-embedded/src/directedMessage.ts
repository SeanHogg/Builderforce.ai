/**
 * Directed messages — addressing a chat turn to a participant, not the BRAIN.
 *
 * A BuilderForce chat is multi-party: alongside the BRAIN (the agent that
 * executes build/change requests) a chat can have other participants — invited
 * teammate agents and (in future) humans. Not every message is a directive for
 * the BRAIN to run: a user can @-tag a participant and simply talk to them. Such
 * a turn is a normal `user` message tagged with `{ addressedTo: {...} }` in its
 * metadata; the conversation loop reads that flag and does NOT start a BRAIN run
 * for it, while the transcript still shows who it was addressed to. An untagged
 * message (or one addressed to the BRAIN) runs the agent loop as before.
 *
 * This is the single source of truth for the convention, shared by the send path
 * (which skips the run), the auto-reply guard, and any surface that renders the
 * "→ recipient" badge.
 */

/** A non-BRAIN participant a message can be addressed to. */
export interface DirectedRecipient {
  /** 'agent' = an invited teammate agent; 'human' = an invited person. */
  kind: 'agent' | 'human';
  /** Stable id/ref of the participant (an agentRef, or a user id/handle). */
  ref: string;
  /** Display name shown in the composer chip + the transcript badge. */
  name: string;
}

/** The metadata key that flags a user message as addressed to a participant. */
export const ADDRESSED_TO_META_KEY = 'addressedTo';

/** The metadata key that attributes an assistant turn to a specific participant
 *  (an invited agent that replied), rather than the default BRAIN. Mirrors
 *  {@link ADDRESSED_TO_META_KEY} on the answering side. */
export const AUTHORED_BY_META_KEY = 'authoredBy';

/** The participant that authored an assistant turn, or `null` for the BRAIN. */
export function parseMessageAuthor(msg: { metadata?: string | null }): DirectedRecipient | null {
  if (!msg.metadata) return null;
  try {
    const a = (JSON.parse(msg.metadata) as { authoredBy?: Partial<DirectedRecipient> }).authoredBy;
    if (a && typeof a.ref === 'string' && typeof a.name === 'string' && (a.kind === 'agent' || a.kind === 'human')) {
      return { kind: a.kind, ref: a.ref, name: a.name };
    }
  } catch {
    /* not an attributed message */
  }
  return null;
}

/**
 * Merge an `addressedTo` flag into a message's metadata object (preserving any
 * other keys, e.g. `attachments`). Returns a serialized string, or `undefined`
 * when there is nothing to store — ready to hand to `persistence.sendMessages`.
 */
export function withDirectedMetadata(
  recipient: DirectedRecipient | null | undefined,
  base?: Record<string, unknown>,
): string | undefined {
  const meta: Record<string, unknown> = { ...(base ?? {}) };
  if (recipient) meta[ADDRESSED_TO_META_KEY] = recipient;
  return Object.keys(meta).length > 0 ? JSON.stringify(meta) : undefined;
}

/** The recipient a persisted message was addressed to, or `null` for the BRAIN. */
export function parseDirectedRecipient(msg: { metadata?: string | null }): DirectedRecipient | null {
  if (!msg.metadata) return null;
  try {
    const a = (JSON.parse(msg.metadata) as { addressedTo?: Partial<DirectedRecipient> }).addressedTo;
    if (a && typeof a.ref === 'string' && typeof a.name === 'string' && (a.kind === 'agent' || a.kind === 'human')) {
      return { kind: a.kind, ref: a.ref, name: a.name };
    }
  } catch {
    /* not a directed message */
  }
  return null;
}

/** True when a message is addressed to a participant (so the BRAIN should NOT run for it). */
export function isDirectedToParticipant(msg: { metadata?: string | null }): boolean {
  return parseDirectedRecipient(msg) !== null;
}

/**
 * A composer's recipient choice: `null` = auto (follow any leading @mention),
 * `'brain'` = explicitly the BRAIN, or an explicit participant. An explicit
 * choice always wins over a typed @mention.
 */
export type RecipientChoice = DirectedRecipient | 'brain' | null;

/** An in-progress "@mention" being typed at the caret — what a composer typeahead
 *  offers a picker for. */
export interface MentionToken {
  /** The text typed after '@' (before the caret); '' right after typing '@'. */
  query: string;
  /** Index of the '@' character in the text. */
  start: number;
  /** Index just past the query (the caret position). */
  end: number;
}

/**
 * Detect an in-progress "@mention" at the caret, for a composer typeahead. The
 * token is an '@' at the start of the text or right after whitespace, followed by
 * a run of non-whitespace, non-'@' characters, with the caret inside that run.
 * Returns null when the caret is not in such a token (so no picker should show).
 * Deliberately mirrors {@link mentionRecipient}'s `@([^\s@]+)` grammar so what the
 * typeahead offers and what a leading mention resolves to stay consistent.
 */
export function activeMentionToken(text: string, caret: number): MentionToken | null {
  const at = text.lastIndexOf('@', Math.max(0, caret - 1));
  // No '@', or the caret sits at/before it (nothing is being typed into a token).
  if (at < 0 || at >= caret) return null;
  // Must start the text or follow whitespace, so an email address's "@" never triggers.
  if (at > 0 && !/\s/.test(text[at - 1])) return null;
  const query = text.slice(at + 1, caret);
  // The run from '@' to the caret must be one unbroken token (no space/@ inside).
  if (/[\s@]/.test(query)) return null;
  return { query, start: at, end: caret };
}

/**
 * Filter + rank participants for a mention query — case-insensitive substring
 * match, name-start matches first. An empty query returns every participant (so
 * typing a bare '@' opens the full roster). Shared by every composer's typeahead.
 */
export function filterMentionCandidates(participants: DirectedRecipient[], query: string): DirectedRecipient[] {
  const q = query.trim().toLowerCase();
  if (!q) return participants;
  return participants
    .map((p) => ({ p, idx: p.name.toLowerCase().indexOf(q) }))
    .filter((s) => s.idx >= 0)
    .sort((a, b) => a.idx - b.idx || a.p.name.localeCompare(b.p.name))
    .map((s) => s.p);
}

/** Resolve a leading "@name" in composer text to one of `participants`, if any. */
export function mentionRecipient(text: string, participants: DirectedRecipient[]): DirectedRecipient | null {
  const m = /^\s*@([^\s@]+)/.exec(text);
  if (!m) return null;
  const tag = m[1].toLowerCase();
  return (
    participants.find((p) => {
      const name = p.name.toLowerCase();
      return name === tag || name.split(/\s+/)[0] === tag || name.startsWith(tag);
    }) ?? null
  );
}

/**
 * The effective target of the next message: an explicit BRAIN pick wins (→ null,
 * runs the BRAIN); else an explicit participant; else a leading @mention; else the
 * BRAIN. Shared by every composer so routing is identical across surfaces.
 */
export function resolveRecipient(choice: RecipientChoice, mention: DirectedRecipient | null): DirectedRecipient | null {
  if (choice === 'brain') return null;
  return choice ?? mention;
}

/**
 * What an invited agent brings to a turn a HOST runs itself: its compiled persona.
 *
 * The server's addressed-agent reply (`BrainService.agentReply`) runs under these
 * same directives but with platform tools only — it has no workspace. A host that HAS
 * one (the editor) fetches this and runs the turn in its own loop, so the agent gets
 * the host's tools; that is the difference between "I have no git tool" and a commit.
 */
export interface AddressedAgentPersona {
  /** Persona + knowledge directives, compiled server-side from the agent's row. */
  directives: string;
  /** The agent's own pinned base model, or null when it follows the surface's pick. */
  model?: string | null;
}

/**
 * Attribute a persisted assistant turn to a participant: merge `authoredBy` into
 * its metadata, keeping whatever else is there (the model/account provenance).
 * The read side is {@link parseMessageAuthor}; this is its only writer on a host.
 */
export function withAuthoredBy(metadata: string | undefined, author: DirectedRecipient | null | undefined): string | undefined {
  if (!author) return metadata;
  let base: Record<string, unknown> = {};
  if (metadata) {
    try {
      const parsed = JSON.parse(metadata) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) base = parsed as Record<string, unknown>;
    } catch {
      /* not JSON — replaced rather than corrupted */
    }
  }
  return JSON.stringify({ ...base, [AUTHORED_BY_META_KEY]: author });
}

/**
 * The system prompt for a host-run addressed turn: the agent's persona FIRST (who is
 * speaking), then the host's own prompt (what this surface can do and how). Order
 * matters — the host prompt names the tools, and an instruction to use them must not
 * be overridden by a persona that knows nothing about the surface.
 */
export function addressedAgentSystemPrompt(persona: AddressedAgentPersona, agent: DirectedRecipient, hostPrompt: string): string {
  const framing =
    `You have been addressed directly as ${agent.name} in this multi-party chat. Reply AS ${agent.name} — first person, no "${agent.name}:" label. ` +
    'The tools available to you are the tools of the surface you are running on right now; the instructions below say what they are and how to use them, and they apply to you in full.';
  // No compiled persona (a participant the server could not resolve) is still a
  // participant: it speaks under its name, the same fallback the server reply uses.
  const who = persona.directives.trim() || `You are ${agent.name}, a member of this team's chat.`;
  return [who, framing, hostPrompt].join('\n\n');
}
