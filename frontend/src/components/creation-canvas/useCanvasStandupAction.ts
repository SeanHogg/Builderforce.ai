/*
 * No `'use client'` — a hook called only from `CreationCanvas.tsx`, inside its own
 * client boundary.
 */
import { useCallback, useEffect, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useOptionalProjectScope } from '@/lib/ProjectScopeContext';
import { resolveStandupProject } from '@/lib/canvas/standupProject';
import { MAX_ADDRESSED_AGENTS, mentionTokens } from '@/lib/canvas/agentMentions';
import { uniqueBoardAgents, type BoardAgent } from '@/lib/canvas/boardAgents';
import type { RoomOccupant } from '@/lib/canvas/roomSeating';
import type { CanvasSessionActionHandler } from './CanvasSessionActions';
import { useRoomStandup, type RoomStandupParticipant } from './useRoomStandup';

/**
 * THE STANDUP IS A SESSION ACTION — one glyph beside "Start a call", on every surface.
 *
 * ── WHY IT LEFT THE ROOM'S BAR ───────────────────────────────────────────────────
 * The room used to publish a whole captioned group into the session bar — a project
 * picker, two step buttons and a Start button — which pushed the bar out under the
 * Brain panel and put a meeting's controls behind one surface. A standup is people
 * agreeing to talk about this canvas, which is exactly what a call is; so it is
 * filed where the call is (`cluster: 'reach'`, `lib/canvasSessionActions.ts`) and
 * drawn by the same renderer with the same chrome.
 *
 * ── WHAT DECIDES THE PROJECT ─────────────────────────────────────────────────────
 * The project a person is working IN, then the one this board names, then none —
 * `resolveStandupProject`, the same rule the host's "gather a standup" object uses.
 * There is no picker any more: walking every project was a mode the bar could not
 * afford, and a standup against the scoped project is what the button is for.
 *
 * ── WHO ANSWERS ──────────────────────────────────────────────────────────────────
 * The agents at the table, each in its own name. Starting a standup sends one turn
 * into this canvas's conversation that @-addresses every agent on the board — the
 * same path a person typing "@CMO @CFO …" takes (`mentionedBoardAgents`), with the
 * same cap — so each gives its update as itself, Brain closes with the summary, and
 * in the room each update is drawn over the head of the agent who gave it.
 *
 * ── WHEN IT IS OFFERED ───────────────────────────────────────────────────────────
 * The ceremony record (attendance, the cadence rollup) belongs to a PROJECT, so what
 * it needs is a workspace to file it in — not a board saved to the server. A signed-in
 * person on a board that lives on this device still stands up against their scoped
 * project. It used to be switched off for every device-only board, which drew the
 * button disabled in a room full of agents with nothing saying why. Now it is disabled
 * only when there is neither a project to file against nor an agent to ask, or while
 * an act is in flight. With no workspace no project resolves, so the 30s liveness poll
 * behind the record never runs.
 *
 * Returns a handler in the registry's own shape, so the host adds ONE entry to its
 * map and learns nothing about ceremonies.
 */
export interface CanvasStandupActionInput {
  /** The session roster — the people the ceremony record takes attendance of. */
  members: readonly RoomOccupant[];
  /** The agent cards on the board — each gives its update in its own name. */
  agents: readonly BoardAgent[];
  boardProjectId: number | null;
  /** Whether there is a workspace to file a ceremony record in. */
  ceremonyEnabled: boolean;
  onError: (message: string) => void;
  /** Send the round to the agents as a turn in this canvas's conversation. */
  onAgentRound: (prompt: string) => void;
}

export function useCanvasStandupAction({
  members, agents, boardProjectId, ceremonyEnabled, onError, onAgentRound,
}: CanvasStandupActionInput): CanvasSessionActionHandler {
  const t = useTranslations('creationCanvas');
  const scope = useOptionalProjectScope();
  const projectId = ceremonyEnabled
    ? resolveStandupProject({ scopeProjectId: scope?.currentProjectId ?? null, boardProjectId }).projectId
    : null;

  const participants = useMemo<RoomStandupParticipant[]>(
    // Everyone on a canvas roster is a person: agents attend through their own seats
    // on the ceremony round table, not through a browser session here.
    () => members.map((member) => ({ kind: 'human' as const, ref: member.userId, name: member.displayName || member.userId })),
    [members],
  );

  const standup = useRoomStandup(projectId, participants);
  const live = !!standup.session;
  const startCeremony = standup.start;

  // A failed start or finish is a notice, the way every other failed session act is —
  // not a second error strip the bar would have to find room for.
  useEffect(() => {
    if (!standup.error) return;
    onError(standup.error);
    standup.dismissError();
  }, [onError, standup]);

  const roundAgents = useMemo(() => uniqueBoardAgents(agents).slice(0, MAX_ADDRESSED_AGENTS), [agents]);
  const begin = useCallback(() => {
    if (projectId != null) startCeremony();
    if (roundAgents.length) onAgentRound(t('standupRoundPrompt', { mentions: mentionTokens(roundAgents) }));
  }, [onAgentRound, projectId, roundAgents, startCeremony, t]);

  return useMemo<CanvasSessionActionHandler>(() => ({
    run: live ? standup.finish : begin,
    active: live,
    // Nothing to file it against and nobody to ask, or an act already in flight.
    // Disabled rather than withdrawn: the button that WOULD start it is the explanation.
    disabled: standup.busy || (projectId == null && roundAgents.length === 0),
  }), [begin, live, projectId, roundAgents.length, standup.busy, standup.finish]);
}
