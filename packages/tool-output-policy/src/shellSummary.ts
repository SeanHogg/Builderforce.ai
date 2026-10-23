/**
 * The shell/test/build output summarizer.
 *
 * A failing `pnpm test` prints thousands of lines of passing noise and buries the few
 * that matter — which test failed, the assertion diff, the compiler error — somewhere
 * in the middle. A head slice hands the model the noise and drops the verdict; a tail
 * slice keeps the verdict and drops the failure detail. This keeps what a developer
 * would read: the failing test names, every error line, the assertion diffs, and the
 * last {@link DEFAULT_TAIL_LINES} lines, and says how much passing output it dropped.
 *
 * Recognises vitest, jest, pytest, cargo, tsc and go test; anything else still gets the
 * generic error-line + tail treatment.
 */

import { cutHead, cutHeadTail } from './textCut.js';

export type OutputRunner = 'vitest' | 'jest' | 'pytest' | 'cargo' | 'tsc' | 'go' | 'unknown';

export const DEFAULT_TAIL_LINES = 40;

/** Assertion-diff lines kept after a diff header. */
const MAX_DIFF_LINES = 24;

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI, '');
}

const RUNNER_SIGNATURES: ReadonlyArray<[OutputRunner, RegExp]> = [
  ['vitest', /\bvitest\b|^\s*(?:Test Files|Tests)\s+\d+\s+(?:failed|passed)|^\s*[❯›]\s+\S+\.(?:test|spec)\.[cm]?[jt]sx?/m],
  ['jest', /^\s*(?:PASS|FAIL)\s+\S+\.(?:test|spec)\.[cm]?[jt]sx?|^Test Suites:\s+\d+/m],
  ['pytest', /=+ test session starts =+|^(?:FAILED|ERROR) \S+::|=+ .*\b(?:passed|failed)\b.* in [\d.]+s =+/m],
  ['cargo', /^\s*(?:Compiling|Finished|Running) .*|^test result: (?:ok|FAILED)\.|^error(?:\[E\d+\])?: /m],
  ['tsc', /\berror TS\d+:/],
  ['go', /^(?:---|===) (?:FAIL|RUN|PASS):|^(?:ok|FAIL)\s+\S+\s+[\d.]+s/m],
];

/** Which test/build tool printed this output. */
export function detectRunner(text: string): OutputRunner {
  for (const [runner, re] of RUNNER_SIGNATURES) if (re.test(text)) return runner;
  return 'unknown';
}

/** Lines that are pure passing / progress noise. */
const NOISE = [
  /^\s*[✓√✔]\s/,
  /^\s*PASS\s/,
  /^\s*PASSED\b/,
  /\bPASSED\s*(?:\[\s*\d+%\])?$/,
  /^test .* \.\.\. ok$/,
  /^ok\s+\S+\s+[\d.]+s/,
  /^=== RUN\s/,
  /^--- PASS:/,
  /^\s*Compiling\s/,
  /^\s*Downloaded?\s/,
  /^\s*$/,
];

/** Lines that name a failure or an error. */
const ERROR_LINE = [
  /\berror\b|\bERROR\b|\bError\b/,
  /\bFAIL(?:ED|URE)?\b|\bfailed\b/,
  /^\s*[✗×✕❌]\s/,
  /\bpanic(?:ked)?\b|^Traceback \(most recent call last\)/,
  /\bAssertion(?:Error)?\b|\bassert(?:ion)?\b/,
  /^E\s{2,}/, // pytest assertion detail
  /^\s*●\s/, // jest failing test header
  /\berror TS\d+:/,
  /^\s*-->\s.+:\d+:\d+$/, // cargo error location
];

/** Lines that open an assertion diff — the following +/- lines are kept with them. */
const DIFF_HEADER = /^\s*(?:[-+]\s*Expected|[-+]\s*Received|Expected:|Received:|expected:|actual:|Difference:|- expected|\+ actual|assert .* ==)/;
const DIFF_BODY = /^\s*[-+](?!-)|^\s{2,}\S/;

/** Failing-test name extractors, per runner. Group 1 is the name. */
const FAILING_TEST: ReadonlyArray<RegExp> = [
  /^\s*(?:FAIL|×|✕|✗)\s+(\S+\.(?:test|spec)\.[cm]?[jt]sx?(?:\s+>\s+.+?)?)(?:\s+\d+ms)?$/, // vitest/jest file (+ test path)
  /^\s*●\s+(.+?)\s*$/, // jest
  /^\s*[×✕✗]\s+(.+?)(?:\s+\d+ms)?$/, // vitest/jest test line
  /^FAILED\s+(\S+::\S+)/, // pytest
  /^test\s+(\S+)\s+\.\.\.\s+FAILED$/, // cargo
  /^---\s+FAIL:\s+(\S+)/, // go
];

export interface ShellSummaryOptions {
  maxChars: number;
  tailLines?: number;
}

export interface ShellSummary {
  text: string;
  runner: OutputRunner;
  failingTests: string[];
  /** Passing/progress lines dropped from the body. */
  droppedNoise: number;
}

function isNoise(line: string): boolean {
  return NOISE.some((re) => re.test(line));
}

function isErrorLine(line: string): boolean {
  return ERROR_LINE.some((re) => re.test(line));
}

function failingTestName(line: string): string | null {
  for (const re of FAILING_TEST) {
    const m = re.exec(line);
    if (m && m[1]) return m[1].trim();
  }
  return null;
}

/**
 * Summarize a shell/test/build log to fit `maxChars`. Output already within budget is
 * returned untouched (ANSI and all) — the summarizer only ever runs when something has
 * to be dropped.
 */
export function summarizeShellOutput(raw: string, opts: ShellSummaryOptions): ShellSummary {
  const tailLines = opts.tailLines ?? DEFAULT_TAIL_LINES;
  if (raw.length <= opts.maxChars) {
    return { text: raw, runner: detectRunner(raw), failingTests: [], droppedNoise: 0 };
  }
  const text = stripAnsi(raw).replace(/\r\n?/g, '\n');
  const runner = detectRunner(text);
  const lines = text.split('\n');
  const tailFrom = Math.max(0, lines.length - tailLines);
  const tail = lines.slice(tailFrom);

  const failing: string[] = [];
  const seenFailing = new Set<string>();
  const kept: string[] = [];
  const seenKept = new Set<string>();
  let droppedNoise = 0;
  let diffLeft = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const name = failingTestName(line);
    if (name && !seenFailing.has(name)) {
      seenFailing.add(name);
      failing.push(name);
    }
    if (i >= tailFrom) continue; // the tail is shown verbatim below

    if (DIFF_HEADER.test(line)) {
      diffLeft = MAX_DIFF_LINES;
      kept.push(line);
      continue;
    }
    if (diffLeft > 0) {
      if (DIFF_BODY.test(line) && !isNoise(line)) {
        kept.push(line);
        diffLeft--;
        continue;
      }
      diffLeft = 0;
    }
    if (isNoise(line)) {
      droppedNoise++;
      continue;
    }
    if (isErrorLine(line)) {
      const key = line.trim();
      if (seenKept.has(key)) continue;
      seenKept.add(key);
      kept.push(line);
    }
  }

  const header = `[output summarised${runner === 'unknown' ? '' : ` (${runner})`}: ${lines.length.toLocaleString('en-US')} lines / ${raw.length.toLocaleString('en-US')} chars → failing tests, error lines, assertion diffs and the last ${tail.length} lines; ${droppedNoise.toLocaleString('en-US')} passing/progress lines dropped. Re-run a narrower command (one test file, grep) for more.]`;
  const failingBlock = failing.length > 0 ? `Failing tests (${failing.length}):\n${failing.slice(0, 50).map((n) => `  - ${n}`).join('\n')}${failing.length > 50 ? `\n  … +${failing.length - 50} more` : ''}` : '';
  const tailBlock = `--- last ${tail.length} lines ---\n${tail.join('\n')}`;

  // The tail and header are fixed; the error section gets what is left.
  const fixed = [header, failingBlock, tailBlock].filter(Boolean).join('\n\n');
  const room = opts.maxChars - fixed.length - 40;
  let errorsBlock = '';
  if (kept.length > 0 && room > 200) {
    const body = `--- errors (${kept.length} lines) ---\n${kept.join('\n')}`;
    errorsBlock = body.length <= room ? body : cutHead(body, room, { suffix: '\n…[more error lines elided]' });
  }
  const assembled = [header, failingBlock, errorsBlock, tailBlock].filter(Boolean).join('\n\n');
  // Pathological tails (one 50K-char line) still have to fit.
  const fitted = assembled.length <= opts.maxChars ? assembled : cutHeadTail(assembled, opts.maxChars, { headShare: 0.5 });
  return { text: fitted, runner, failingTests: failing, droppedNoise };
}
