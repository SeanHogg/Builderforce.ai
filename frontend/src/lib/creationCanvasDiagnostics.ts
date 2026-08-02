import { capText, environmentLines, line, type DiagnosticsContext } from './diagnosticsReport';

export type CreationCanvasDiagnosticsInput = {
  sessionId: string;
  title: string;
  persistence: 'local' | 'server';
  role: string;
  revision: number;
  realtimeState: string;
  objectCount: number;
  connectionCount: number;
  objectKinds: Record<string, number>;
  selectedObjectIds: string[];
  hiddenObjectCount: number;
  lockedObjectCount: number;
  redactedObjectCount: number;
  canonicalResourceCount: number;
  memberCount: number;
  pendingInvitationCount: number;
  timeline: Array<{ role: string; body: string; createdAt: string }>;
  brain: { scope: string; thinking: boolean; proposedChangeCount: number; actionCount: number };
};

/** A pasteable, bounded handover for Canvas/Brain support tickets. */
export function buildCreationCanvasDiagnosticsReport(input: CreationCanvasDiagnosticsInput, context: DiagnosticsContext): string {
  const transcript = input.timeline.slice(-20);
  return [
    `# Creation Canvas diagnostics — ${input.title}`,
    '',
    ...environmentLines(context, [['sessionId', input.sessionId], ['persistence', input.persistence], ['role', input.role]]),
    '',
    '-- Session state --',
    line('revision', input.revision),
    line('realtimeState', input.realtimeState),
    line('members', input.memberCount),
    line('pendingInvitations', input.pendingInvitationCount),
    line('objects', input.objectCount),
    line('connections', input.connectionCount),
    line('canonicalResources', input.canonicalResourceCount),
    line('hiddenObjects', input.hiddenObjectCount),
    line('lockedObjects', input.lockedObjectCount),
    line('redactedObjects', input.redactedObjectCount),
    line('selectedObjectIds', input.selectedObjectIds.join(', ') || null),
    line('objectKinds', Object.entries(input.objectKinds).sort(([a], [b]) => a.localeCompare(b)).map(([kind, count]) => `${kind}:${count}`).join(', ') || null),
    '',
    '-- Canvas Brain --',
    line('scope', input.brain.scope),
    line('thinking', input.brain.thinking),
    line('availableCanvasActions', input.brain.actionCount),
    line('proposedChangesAwaitingReview', input.brain.proposedChangeCount),
    line('timelineMessages', input.timeline.length),
    '',
    '-- Recent Session conversation (last 20) --',
    ...(transcript.length ? transcript.flatMap((message) => [
      `[${message.createdAt}] ${message.role}`,
      capText(message.body, 1_000),
    ]) : ['(none)']),
  ].join('\n');
}

