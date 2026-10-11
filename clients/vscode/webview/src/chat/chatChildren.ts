/**
 * A chat's LIVE sub-agents, as the host last announced them (`run.children`).
 *
 * Each child is a run of its own, mirrored into the local store by its run key like any
 * other (`hostRunDriver.ts`), so this holds only WHICH runs are a chat's children; their
 * activity, prompts and Stop are read and driven through the run store by key.
 */

import { useSyncExternalStore } from 'react';
import { getRunSnapshot, subscribeRun, type BrainRunSnapshot, type DirectedRecipient } from '@seanhogg/builderforce-brain-embedded';
import type { ChildView } from '../../../src/childRuns';
import { post } from '../vscodeBridge';

export type { ChildView };

const byChat = new Map<number, ChildView[]>();
const listeners = new Set<() => void>();
const NONE: ChildView[] = [];

/** The host announced a chat's live children. */
export function setChatChildren(chatId: number, children: ChildView[]): void {
  byChat.set(chatId, children);
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

/** One run's live snapshot, by run key — a child's own cell. */
export function useRunSnapshotOf(runKey: number): BrainRunSnapshot {
  return useSyncExternalStore(
    (onChange) => subscribeRun(runKey, onChange),
    () => getRunSnapshot(runKey),
  );
}

/**
 * Put the person's words in front of a RUNNING run's next turn — the chat's own run (a
 * message that would otherwise wait in the queue) or one of its sub-agents.
 */
export function steerRun(runKey: number, text: string): void {
  post('run.steer', { chatId: runKey, text });
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
