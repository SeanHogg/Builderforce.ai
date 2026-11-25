/**
 * The Security Shield's code scanner, in a Web Worker: it keeps hashing and rule matching off the page's
 * main thread, and out of reach of the application code the runtime runs (that code lives in other
 * Workers on other origins). It speaks the `CodeScanner` port's wire shape: `{ id, origin, subjects }`
 * in, `{ id, verdicts }` out. The rules are `@builderforce/code-shield`'s, the same ones the Visualizer
 * and the PR gate run.
 */
import { createMemoryVerdictCache, scanSubjects, type FileVerdict, type ScanSubject } from '@builderforce/code-shield';

export interface CodeScanRequest {
  readonly id: number;
  readonly origin: 'install' | 'write' | 'spawn';
  readonly subjects: readonly ScanSubject[];
}

export interface CodeScanWireVerdict {
  readonly path: string;
  readonly action: FileVerdict['action'];
  readonly complete: boolean;
  readonly score: number;
  readonly ruleIds: readonly string[];
}

export interface CodeScanResponse {
  readonly id: number;
  readonly verdicts: readonly CodeScanWireVerdict[];
}

/** One cache per Worker: an unchanged file is not rescanned. */
const cache = createMemoryVerdictCache();

const toWire = (v: FileVerdict): CodeScanWireVerdict => ({
  path: v.path,
  action: v.action,
  complete: v.complete,
  score: v.score,
  ruleIds: [...new Set(v.findings.map((f) => f.ruleId ?? ''))].filter(Boolean),
});

async function handle({ id, subjects }: CodeScanRequest): Promise<CodeScanResponse> {
  try {
    const report = await scanSubjects(subjects, { profile: 'runtime', cache });
    return { id, verdicts: report.files.map(toWire) };
  } catch {
    // error-logging: a scanner fault fails to INCOMPLETE (the runtime reports code.scan_incomplete), never to a clean verdict
    return { id, verdicts: subjects.map((s) => ({ path: s.path, action: 'review', complete: false, score: 0, ruleIds: [] })) };
  }
}

self.addEventListener('message', (event: MessageEvent<CodeScanRequest>) => {
  void handle(event.data).then((response) => (self as unknown as Worker).postMessage(response));
});
