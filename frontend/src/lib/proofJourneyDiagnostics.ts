import {
  capText, environmentLines, jsonAppendix, line, windowRows,
  type DiagnosticsContext,
} from './diagnosticsReport';
import type { ProofJourney, ProofJourneyAttempt, ProofJourneyEvent } from './builderforceApi';

/**
 * The proof journey handover report.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * The Idea→delivery panel already shows this session's numbers against a
 * tenant baseline — the PROCESS, in aggregate. It cannot answer "why is THIS
 * idea stuck", because an aggregate rate has no idea to point at. This report
 * reads the same session's raw proof-lifecycle events and states, above
 * everything else, where the most recent attempt is stalled and whether the
 * founder chose the proof form the recommender actually advised — the two
 * facts a founder or a teammate reading this needs first, not last.
 *
 * PURE — built on ./diagnosticsReport exactly like the ticket lifecycle and
 * Creation Canvas reports, so a fourth report cannot disagree with the other
 * three about bounding, elision or the environment block.
 */

const EVENT_HEAD = 10;
const EVENT_TAIL = 20;

const STALL_TEXT: Record<NonNullable<ProofJourney['verdict']['stalledAt']>, string> = {
  not_chosen: 'a proof form has not been chosen yet',
  building: 'the chosen proof is still building',
  build_failed: 'the build failed',
  not_reachable: 'the build succeeded but produced no reachable address',
  awaiting_grade: 'the proof is live and awaiting its kill-condition grade',
  abandoned: 'the proof was abandoned before it was graded',
};

function formatAttempt(attempt: ProofJourneyAttempt, index: number): string[] {
  const divergence = attempt.chosenWasTopRecommended === false
    ? ` — DIVERGED from top recommendation "${attempt.topRecommendation?.key ?? '(unknown)'}" (score ${attempt.topRecommendation?.score ?? '?'})`
    : attempt.chosenWasTopRecommended === true ? ' — matched top recommendation' : '';
  return [
    `${index + 1}. ${attempt.realizationId} · target=${attempt.targetKey ?? '(none)'}${divergence}`,
    `    ${line('chosenAt', attempt.chosenAt)}`,
    `    ${line('buildStarted', attempt.build.startedAt)}`,
    `    ${line('buildSucceeded', attempt.build.succeededAt)}`,
    `    ${line('buildFailed', attempt.build.failedAt)}`,
    `    ${line('reachable', attempt.build.reachable)}`,
    `    ${line('gradeStarted', attempt.grade.startedAt)}`,
    `    ${line('gradeResult', attempt.grade.result)}`,
    `    ${line('gradedAt', attempt.grade.resultAt)}`,
  ];
}

function formatEvent(event: ProofJourneyEvent): string {
  const detail = [
    event.metricKey ? `${event.metricKey}=${event.metricValue ?? '?'}${event.unit ? event.unit : ''}` : '',
    event.durationMs != null ? `${event.durationMs}ms` : '',
    Object.keys(event.metadata).length ? capText(JSON.stringify(event.metadata), 200) : '',
  ].filter(Boolean).join(' | ');
  return `[${event.occurredAt}] ${event.action}/${event.phase}${detail ? ` — ${detail}` : ''}`;
}

/** A pasteable, bounded report of one session's Read→Prove→Build→Measure loop. */
export function buildProofJourneyDiagnosticsReport(
  journey: ProofJourney,
  context: DiagnosticsContext,
): string {
  const { verdict, attempts, events } = journey;
  const stallLine = verdict.stalledAt
    ? `Stalled: ${STALL_TEXT[verdict.stalledAt]}`
    : verdict.attemptCount > 0
      ? 'Not stalled — the most recent attempt was graded.'
      : verdict.readCount > 0
        ? 'Not stalled.'
        : 'No idea has been read in this session yet.';

  const recommendationRows = verdict.latestRecommendations.length
    ? verdict.latestRecommendations
      .slice()
      .sort((a, b) => b.score - a.score)
      .map((r) => `  ${r.recommended ? '★' : ' '} ${r.key} — score ${r.score}`)
    : ['  (no read on record)'];

  const attemptRows = attempts.length
    ? attempts.flatMap((attempt, index) => formatAttempt(attempt, index))
    : ['  (no proof form chosen yet)'];

  const eventRows = events.map(formatEvent);

  const body = [
    `# Proof journey diagnostics — session ${journey.sessionId}`,
    '',
    ...environmentLines(context, [['sessionId', journey.sessionId]]),
    '',
    // ANSWER FIRST: whether the north-star loop closed, and where it did not.
    '-- Verdict --',
    line('reachedGradedProof', verdict.reachedGradedProof),
    stallLine,
    line('firstReadAt', verdict.firstReadAt),
    line('readCount', verdict.readCount),
    line('attemptCount', verdict.attemptCount),
    '',
    '-- Recommendations (most recent read, ★ = top pick) --',
    ...recommendationRows,
    '',
    `-- Attempts (${attempts.length}) --`,
    ...attemptRows,
    '',
    `-- Raw events (${events.length}) --`,
    ...(eventRows.length
      ? windowRows(eventRows, { head: EVENT_HEAD, tail: EVENT_TAIL, note: (elided) => [`… ${elided} earlier events elided …`] })
      : ['  (none)']),
  ];

  const text = body.join('\n');
  return [
    text,
    '',
    ...jsonAppendix(text.length, { attempts, events, verdict }, {
      compact: () => ({ attempts, verdict }),
      note: '(raw events omitted to stay within the paste budget — rendered above)',
    }),
  ].join('\n');
}
