/**
 * A pasteable snapshot of the Quality error queue.
 *
 * Unlike the on-screen list, which is paginated for rendering, the caller supplies
 * every matching group. The report deliberately keeps every row: this export is the
 * escape hatch used when an operator needs to hand the complete error inventory to a
 * person or another agent.
 */
import type { ErrorGroup, QualityStats } from './builderforceApi';
import { environmentLines, line, type DiagnosticsContext } from './diagnosticsReport';

export interface QualityDiagnosticsInput {
  projectId: number | null;
  status: string | null;
  level: string | null;
  groups: ErrorGroup[];
  stats: QualityStats | null;
  statsError?: string | null;
}

export function buildQualityDiagnosticsReport(
  input: QualityDiagnosticsInput,
  ctx: DiagnosticsContext,
): string {
  const events = input.groups.reduce((sum, group) => sum + group.eventCount, 0);
  const users = input.groups.reduce((sum, group) => sum + group.userCount, 0);
  const collectorless = input.groups.filter((group) => group.collectorId == null).length;

  const lines = [
    '# Product Quality diagnostics',
    '',
    ...environmentLines(ctx, [['projectId', input.projectId ?? 'all projects']]),
    '',
    '-- Export scope --',
    line('statusFilter', input.status ?? 'all statuses'),
    line('levelFilter', input.level ?? 'all levels'),
    line('errorGroups', input.groups.length),
    line('eventsAcrossExportedGroups', events),
    line('usersAcrossExportedGroups', users),
    line('groupsWithoutCollector', collectorless),
    'collectorNote: A missing collector means the error came directly from an in-app/internal Builderforce reporter, or its collector was later deleted. The error is retained intentionally.',
    '',
    '-- Quality overview (unfiltered, 30-day window) --',
  ];

  if (input.stats) {
    lines.push(
      line('windowDays', input.stats.windowDays),
      line('groups', input.stats.totals.groups),
      line('events', input.stats.totals.events),
      line('users', input.stats.totals.users),
      `byLevel: ${input.stats.byLevel.map((row) => `${row.level}=${row.groups} groups/${row.events} events`).join(', ') || '(none)'}`,
      `byStatus: ${input.stats.byStatus.map((row) => `${row.status}=${row.groups}`).join(', ') || '(none)'}`,
      `bySource: ${(input.stats.bySource ?? []).map((row) => `${row.source}=${row.events}`).join(', ') || '(none)'}`,
      `byCollector: ${input.stats.byCollector.map((row) => `${row.name ?? 'direct / removed collector'}=${row.groups} groups/${row.events} events`).join(', ') || '(none)'}`,
    );
  } else {
    lines.push(`overviewUnavailable: ${input.statsError ?? 'the quality overview could not be loaded'}`);
  }

  lines.push('', `-- All matching errors (${input.groups.length}) --`);
  if (input.groups.length === 0) lines.push('(none)');
  for (const [index, group] of input.groups.entries()) {
    lines.push(
      '',
      `## ${index + 1}. ${group.title}`,
      line('id', group.id),
      line('fingerprint', group.fingerprint),
      line('type', group.type),
      line('level', group.level),
      line('status', group.status),
      line('projectId', group.projectId),
      line('collectorId', group.collectorId),
      line('events', group.eventCount),
      line('users', group.userCount),
      line('firstSeen', group.firstSeen),
      line('lastSeen', group.lastSeen),
      line('environment', group.environment),
      line('release', group.release),
      line('fixTaskId', group.taskId),
    );
  }

  lines.push('', '-- Raw error groups (JSON) --', JSON.stringify(input.groups, null, 2));
  return lines.join('\n');
}
