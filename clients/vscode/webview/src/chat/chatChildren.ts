/**
 * A chat's LIVE sub-agents, as the host last announced them (`run.children`).
 *
 * Each child is a run of its own, mirrored into the local store by its run key like any
 * other (`hostRunDriver.ts`), so this holds only WHICH runs are a chat's children; their
 * activity, prompts and Stop are read and driven through the run store by key.
 */

import { useMemo, useSyncExternalStore } from 'react';
import { getRunSnapshot, getRunTrace, isModelReply, type ChatInputAttachment, type DirectedRecipient, type SteerTurn, type SubagentDiagnosticsInput } from '@seanhogg/builderforce-brain-embedded';
import type { ChatSubagentVM } from '@seanhogg/builderforce-brain-ui';
import type { ChildView } from '../../../src/childRuns';
import { post } from '../vscodeBridge';

export type { ChildView };

const byChat = new Map<number, ChildView[]>();
/** Every child a chat has had this session, live or settled — a settled child leaves the
 *  live list, but its run (and why it failed) is still what a triage report needs. */
const everByChat = new Map<number, Map<number, ChildView>>();
const listeners = new Set<() => void>();
const NONE: ChildView[] = [];

/** The host announced a chat's live children. */
export function setChatChildren(chatId: number, children: ChildView[]): void {
  byChat.set(chatId, children);
  const ever = everByChat.get(chatId) ?? new Map<number, ChildView>();
  for (const c of children) ever.set(c.key, c);
  everByChat.set(chatId, ever);
  for (const listener of listeners) listener();
}

/** A chat's live sub-agents. */
export function useChatChildren(chatId: number | null): ChildView[] {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => (chatId == null ? NONE : byChat.get(chatId) ?? NONE),
  );
}

/**
 * How many sub-agents are live for a chat RIGHT NOW — a synchronous read of the
 * module-level map, for callers that are not React components (e.g. the history
 * list composing a row's stats pill on each render).
 */
export function getChatChildrenCount(chatId: number): number {
  return byChat.get(chatId)?.length ?? 0;
}

/**
 * Every sub-agent announced for a chat this session — live or already settled.
 * A settled child leaves the live list once its run ends, but the history row
 * still wants to say the chat HAD agents working it, so the chip falls back to
 * this when nothing is live right now.
 */
export function getAnnouncedChatChildrenCount(chatId: number): number {
  const live = byChat.get(chatId)?.length ?? 0;
  if (live > 0) return live;
  return everByChat.get(chatId)?.size ?? 0;
}

/**
 * The REACTIVE read of {@link getAnnouncedChatChildrenCount} for React rows: the
 * history chip re-renders the moment the host announces (or settles) a chat's
 * children, where the synchronous `getChatChildrenCount` read would stay at its
 * first-render value until some unrelated re-render happened to occur.
 */
export function useChatChildrenCount(chatId: number): number {
  useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => getAnnouncedChatChildrenCount(chatId),
  );
  return getAnnouncedChatChildrenCount(chatId);
}

/** A chat's live sub-agents as the Agents roster lists them, beside the invited agents. */
export function useChatSubagentRoster(chatId: number | null): readonly ChatSubagentVM[] {
  const children = useChatChildren(chatId);
  return useMemo(
    () => children.map((c) => ({ key: String(c.key), handle: c.handle, name: c.name, label: c.label, owner: c.owner })),
    [children],
  );
}

/** Every sub-agent of a chat this session, each read from its own run, for a report. */
export function subagentDiagnosticsOf(chatId: number | null): SubagentDiagnosticsInput[] {
  if (chatId == null) return [];
  const live = new Set((byChat.get(chatId) ?? []).map((c) => c.key));
  return [...(everByChat.get(chatId)?.values() ?? [])].map((c) => {
    const snap = getRunSnapshot(c.key);
    const last = [...snap.appended].reverse().find(isModelReply)?.content ?? snap.streamingText;
    return {
      handle: c.handle,
      name: c.name,
      label: c.label,
      owner: c.owner,
      depth: c.depth,
      ...(c.ticket ? { ticket: c.ticket } : {}),
      running: live.has(c.key),
      events: getRunTrace(c.key),
      activity: snap.activity,
      ...(snap.error ? { error: snap.error } : {}),
      ...(last ? { lastMessage: last } : {}),
    };
  });
}

/**
 * Put the person's words in front of a RUNNING run's next turn — the chat's own run (a
 * message that would otherwise wait in the queue) or one of its sub-agents. Attachments
 * the person picked ride along so a mid-run message keeps its images, like a normal send.
 */
export function steerRun(runKey: number, text: string, attachments?: ChatInputAttachment[]): void {
  post('run.steer', { chatId: runKey, text, ...(attachments?.length ? { attachments } : {}) });
}

/** Several turns said to a chat's run together (the run driver's `steer`): the host hears each, and an idle chat takes them as ONE continuation. */
export function steerRunTurns(runKey: number, turns: readonly SteerTurn[]): void {
  post('run.steer', { chatId: runKey, turns });
}

/** How a live sub-agent is addressed in the composer's @-picker — by its run key. */
const CHILD_REF_PREFIX = 'run:';

/**
 * The chat's live sub-agents as @-mentionable participants. A name two children share
 * is told apart by handle, so `@Ada` never reaches the wrong one.
 */
export function childParticipants(children: readonly ChildView[]): DirectedRecipient[] {
  return children.map((c) => ({
    kind: 'agent' as const,
    ref: `${CHILD_REF_PREFIX}${c.key}`,
    name: children.filter((o) => o.name === c.name).length > 1 ? `${c.name}-${c.handle}` : c.name,
  }));
}

/**
 * The live sub-agent a composed message is FOR, or null for the chat's own run.
 *
 * `@Name …` (picked or typed) names the child directly. With no recipient, a `#ticket`
 * the message tags names the child working that ticket — the person speaks of the work,
 * and the agent doing it hears them.
 */
export function childTarget(text: string, to: DirectedRecipient | null, children: readonly ChildView[]): ChildView | null {
  if (to) {
    if (!to.ref.startsWith(CHILD_REF_PREFIX)) return null;
    const key = Number(to.ref.slice(CHILD_REF_PREFIX.length));
    return children.find((c) => c.key === key) ?? null;
  }
  const tagged = new Set([...text.matchAll(/(?:^|\s)#([\w-]+)/g)].map((m) => m[1]!));
  const working = children.filter((c) => c.ticket && tagged.has(c.ticket));
  return working.length === 1 ? working[0]! : null;
}
