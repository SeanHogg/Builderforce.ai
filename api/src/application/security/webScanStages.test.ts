import { describe, it, expect } from 'vitest';
import {
  allStagesNotRun,
  allStagesRequested,
  describeStages,
  isWebScanStageId,
  mergeStageReport,
  parseStageReports,
  stageNotRun,
  stageRan,
  stageRequested,
  WEB_SCAN_STAGE_IDS,
} from './webScanStages';
import { withStageSentence } from './webScanContainerStages';

describe('stage constructors', () => {
  it('always carries a reason when a stage did not run', () => {
    for (const s of allStagesNotRun('no container runtime is bound')) {
      expect(s.status).toBe('not_run');
      expect(s.reason).toBeTruthy();
    }
  });

  it('covers every stage id in both the requested and not-run sets', () => {
    expect(allStagesRequested().map((s) => s.stage)).toEqual([...WEB_SCAN_STAGE_IDS]);
    expect(allStagesNotRun('x').map((s) => s.stage)).toEqual([...WEB_SCAN_STAGE_IDS]);
  });

  it('recognises only known stage ids', () => {
    expect(isWebScanStageId('tls')).toBe(true);
    expect(isWebScanStageId('headers')).toBe(false);
  });
});

describe('mergeStageReport (idempotency per scan + stage)', () => {
  it('promotes a requested stage to ran', () => {
    const merged = mergeStageReport([stageRequested('tls'), stageRequested('cve')], stageRan('tls', 2));
    expect(merged.accepted).toBe(true);
    expect(merged.stages.find((s) => s.stage === 'tls')).toMatchObject({ status: 'ran', findingCount: 2 });
    // The other stage is untouched.
    expect(merged.stages.find((s) => s.stage === 'cve')?.status).toBe('requested');
  });

  it('REFUSES a second report for a stage that already ran — a retry must not double-file', () => {
    const after = mergeStageReport([stageRan('tls', 2)], stageRan('tls', 2));
    expect(after.accepted).toBe(false);
    expect(after.rejectedReason).toContain('already reported');
    expect(after.stages).toHaveLength(1);
    expect(after.stages[0]!.findingCount).toBe(2);
  });

  it('accepts a stage that failed in the container, recording the reason', () => {
    const merged = mergeStageReport([stageRequested('cve')], stageNotRun('cve', 'the fetch timed out'));
    expect(merged.accepted).toBe(true);
    expect(merged.stages[0]).toMatchObject({ status: 'not_run', reason: 'the fetch timed out' });
  });

  it('never lets a stage appear twice in the list', () => {
    let stages = allStagesRequested();
    stages = mergeStageReport(stages, stageRan('tls', 1)).stages;
    stages = mergeStageReport(stages, stageRan('cve', 0)).stages;
    expect(stages.map((s) => s.stage)).toEqual([...WEB_SCAN_STAGE_IDS]);
  });
});

describe('parseStageReports', () => {
  it('reads back what was written', () => {
    const stages = [stageRan('tls', 3, 'ok', '2026-06-01T00:00:00.000Z')];
    expect(parseStageReports(JSON.parse(JSON.stringify(stages)))).toEqual(stages);
  });

  it('treats a legacy null column as no stages rather than throwing', () => {
    expect(parseStageReports(null)).toEqual([]);
    expect(parseStageReports('not json')).toEqual([]);
    expect(parseStageReports({ stage: 'tls' })).toEqual([]);
  });

  it('drops unknown stage ids and defaults an unknown status to not_run', () => {
    const parsed = parseStageReports([
      { stage: 'nope', status: 'ran', findingCount: 9 },
      { stage: 'cve', status: 'weird', findingCount: -1 },
    ]);
    expect(parsed).toEqual([{ stage: 'cve', status: 'not_run', reason: undefined, findingCount: 0, observedAt: undefined }]);
  });
});

describe('describeStages / withStageSentence', () => {
  it('names what ran and why anything did not', () => {
    const sentence = describeStages([stageRan('tls', 2), stageNotRun('cve', 'no advisory feed is configured')]);
    expect(sentence).toContain('TLS certificate: ran (2 finding(s))');
    expect(sentence).toContain('CVE fingerprint: not run — no advisory feed is configured');
  });

  it('rewrites the stage sentence on a summary instead of stacking copies', () => {
    const first = withStageSentence('Scanned https://example.com. Score 80/100.', allStagesRequested());
    const second = withStageSentence(first, [stageRan('tls', 1), stageRan('cve', 0)]);
    expect(second.match(/Stages — /g)).toHaveLength(1);
    expect(second).toContain('Scanned https://example.com. Score 80/100.');
    expect(second).toContain('TLS certificate: ran');
  });

  it('leaves a summary alone when there are no stages', () => {
    expect(withStageSentence('Scanned https://example.com.', [])).toBe('Scanned https://example.com.');
  });
});
