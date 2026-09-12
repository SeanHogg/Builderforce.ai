/**
 * Directed messages — addressing a chat turn to a participant, not the BRAIN.
 *
 * A BuilderForce chat is multi-party: alongside the BRAIN (the agent that
 * executes build/change requests) a chat can have other participants — invited
 * teammate agents and humans. Not every message is a directive for the BRAIN to
 * run: a user can @-tag a participant and simply talk to them. Such a turn is a
 * normal `user` message tagged with `{ addressedTo: {...} }` in its metadata; the
 * conversation loop reads that flag and does NOT start a BRAIN run for it, while
 * the transcript still shows who it was addressed to. An untagged message (or one
 * addressed to the BRAIN) runs the agent loop as before.
 *
 * `addressedTo` has two shapes. ONE participant is stored as the participant
 * itself (`{kind:'agent'|'human', ref, name}`). SEVERAL — a canvas group turn that
 * asks every agent on the board at once — are stored as
 * `{kind:'group', members:[…participants]}`. Readers go through
 * {@link parseDirectedRecipients}, which answers a list for both, so no surface
 * has to know which shape a row carries.
 *
 * This is the single source of truth for the convention, shared by the send path
 * (which skips the run), the auto-reply guard, and any surface that renders the
 * "→ recipients" badge.
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

/** A turn addressed to several participants at once (a canvas group turn). */
export interface DirectedGroup {
  kind: 'group';
  members: DirectedRecipient[];
}

/** The metadata key that flags a user message as addressed to a participant. */
export const ADDRESSED_TO_META_KEY = 'addressedTo';

/** The metadata key that attributes an assistant turn to a specific participant
 *  (an invited agent that replied), rather than the default BRAIN. Mirrors
 *  {@link ADDRESSED_TO_META_KEY} on the answering side. */
export const AUTHORED_BY_META_KEY = 'authoredBy';

/** A well-formed participant, or null — the one validation both keys share. */
function asRecipient(value: unknown): DirectedRecipient | null {
  const a = value as Partial<DirectedRecipient> | null | undefined;
  if (a && typeof a.ref === 'string' && typeof a.name === 'string' && (a.kind === 'agent' || a.kind === 'human')) {
    return { kind: a.kind, ref: a.ref, name: a.name };
  }
  return null;
}

/** The participant that authored an assistant turn, or `null` for the BRAIN. */
export function parseMessageAuthor(msg: { metadata?: string | null }): DirectedRecipient | null {
  if (!msg.metadata) return null;
  try {
    return asRecipient((JSON.parse(msg.metadata) as { authoredBy?: unknown }).authoredBy);
  } catch {
    /* not an attributed message */
  }
  return null;
}

/**
 * Merge an `addressedTo` flag into a message's metadata object (preserving any
 * other keys, e.g. `attachments`). One recipient is stored as itself; two or more
 * as a {@link DirectedGroup}. Returns a serialized string, or `undefined` when
 * there is nothing to store — ready to hand to `persistence.sendMessages`.
 */
export function withDirectedMetadata(
  recipient: DirectedRecipient | readonly DirectedRecipient[] | null | undefined,
  base?: Record<string, unknown>,
): string | undefined {
  const meta: Record<string, unknown> = { ...(base ?? {}) };
  const list: readonly DirectedRecipient[] = recipient == null ? [] : 'kind' in recipient ? [recipient] : recipient;
  if (list.length === 1) meta[ADDRESSED_TO_META_KEY] = list[0];
  else if (list.length > 1) meta[ADDRESSED_TO_META_KEY] = { kind: 'group', members: [...list] } satisfies DirectedGroup;
  return Object.keys(meta).length > 0 ? JSON.stringify(meta) : undefined;
}

/**
 * Everyone a persisted message was addressed to — empty for a BRAIN turn, one
 * entry for a directed turn, several for a group turn.
 *
 * Group rows written before members carried names stored bare agent refs
 * (`{kind:'group', refs}`); those still read as addressed, named by their ref, so
 * the transcript says SOMETHING true about them and the BRAIN still stays idle.
 */
export function parseDirectedRecipients(msg: { metadata?: string | null }): DirectedRecipient[] {
  if (!msg.metadata) return [];
  try {
    const a = (JSON.parse(msg.metadata) as { addressedTo?: unknown }).addressedTo as
      | { kind?: unknown; members?: unknown; refs?: unknown }
      | null
      | undefined;
    if (!a || typeof a !== 'object') return [];
    if (a.kind !== 'group') {
      const one = asRecipient(a);
      return one ? [one] : [];
    }
    if (Array.isArray(a.members)) {
      return a.members.map(asRecipient).filter((r): r is DirectedRecipient => r !== null);
    }
    if (Array.isArray(a.refs)) {
      return a.refs
        .filter((ref): ref is string => typeof ref === 'string' && ref.length > 0)
        .map((ref) => ({ kind: 'agent' as const, ref, name: ref }));
    }
  } catch {
    /* not a directed message */
  }
  return [];
}

/**
 * True when a message is addressed to one or more participants — a directed OR a
 * group turn — so the BRAIN must NOT run for it: whoever it was put to owns the
 * reply.
 */
export function isDirectedToParticipant(msg: { metadata?: string | null }): boolean {
  return parseDirectedRecipients(msg).length > 0;
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
