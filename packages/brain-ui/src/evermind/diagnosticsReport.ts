/**
 * The Evermind diagnostics report — everything the console knows about a model's
 * state, its actual output, and its audited knowledge, flattened into one pasteable
 * markdown document.
 *
 * WHY THIS EXISTS. The console can now show an operator that their model is producing
 * gibberish — but seeing it and being able to HAND IT TO SOMEONE were different
 * problems. Screenshotting a panel loses the verbatim output (which is the whole
 * evidence: the exact bytes, the replacement characters, the refusal reason), and
 * nobody retypes a broken token stream. Without an export, "my Evermind is broken"
 * reaches a developer as a description of the symptom rather than the symptom itself.
 *
 * The report is deliberately ENGLISH and deliberately not localized. It is a
 * diagnostic artifact — the same category as a stack trace or a HAR file — read by
 * whoever is debugging the model, not by the operator's UI. Localizing it would
 * translate the technical vocabulary the reader needs (`non-words`, `v1140`,
 * `passRate`) while adding ~30 label keys across five catalogs for strings no user is
 * meant to read as prose. The BUTTON that produces it is localized; the payload is not.
 *
 * Everything is capped: a diagnostics blob that blows a paste limit is not diagnostics.
 */
import type {
  EvermindConsoleData,
  EvermindKnowledgeAnalysis,
  EvermindProbeResult,
  EvermindTarget,
} from './types';
import { evermindLearnedStatus } from './learnedStatus';
import { evermindNextAction } from './actionGuide';

/** Caps — generous enough to keep the evidence, small enough to paste anywhere. */
const MAX_OUTPUT_CHARS = 1200;
const MAX_EXCERPT_CHARS = 400;
const MAX_RECENT = 10;
const MAX_FINDINGS = 20;

export interface EvermindDiagnosticsInput {
  /** Head state — null when the console never loaded (itself worth reporting). */
  data: EvermindConsoleData | null;
  /** The project this console is scoped to, when the host knows it. */
  projectName?: string | undefined;
  /** Which host produced the report — the two surfaces fail differently. */
  host: 'web' | 'vscode';
  /** Everminds under this project, when the host lists them. */
  targets?: EvermindTarget[] | null | undefined;
  /** The most recent test-bench run, when one was made this session. */
  probe?: EvermindProbeResult | null | undefined;
  /** The most recent knowledge audit, when one was run this session. */
  analysis?: EvermindKnowledgeAnalysis | null | undefined;
  /** The last error the console surfaced, if any. */
  error?: string | null | undefined;
  /** Epoch ms to stamp — injected so the output is deterministic under test. */
  now: number;
}

/** Trim to `max`, marking the cut so a truncated sample is never mistaken for the
 *  model stopping there — that difference matters when the bug IS early truncation. */
function clamp(text: string, max: number): string {
  const s = text.trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n…[truncated ${s.length - max} more characters]`;
}

/** A fenced block. The model's output routinely contains backticks and broken
 *  token markers (`<|endoftext|>`), so the fence is long enough not to be closed
 *  by its own content. */
function fence(text: string): string {
  return `~~~\n${text || '(empty)'}\n~~~`;
}

function yesNo(v: boolean): string {
  return v ? 'yes' : 'no';
}

function isoOrNever(value: string | null | undefined): string {
  return value ? new Date(value).toISOString() : 'never';
}

/** Head state — the answer to "what was switched on when this went wrong". */
function headSection(d: EvermindConsoleData): string[] {
  const lines = [
    '## Model state',
    '',
    `- Version: v${d.version}`,
    `- Seeded: ${yesNo(d.seeded)}`,
    `- Learning: ${d.mode === 'connected' ? 'connected' : 'frozen'}`,
    `- Serving replies (inference): ${d.inferenceEnabled ? 'ON' : 'off'}`,
    `- Teacher model: ${d.teacherModel || 'none (learns from raw runs)'}`,
    `- Learned contributions: ${d.contributions}`,
    `- Queued (unmerged): ${d.pending}`,
    `- Last learned: ${isoOrNever(d.lastLearnedAt)}`,
  ];
  if (d.inherited) {
    lines.push(`- INHERITED from project #${d.inheritedFromProjectId ?? '?'} (this build has no Evermind of its own; the console is read-only)`);
  }
  if (d.quarantinedAt) {
    lines.push(`- QUARANTINED at ${isoOrNever(d.quarantinedAt)} — ${d.quarantineReason?.trim() || 'no reason recorded'}`);
  }
  const e = d.eval;
  if (e) {
    const dir = e.delta > 0 ? 'improved' : e.delta < 0 ? 'REGRESSED' : 'flat';
    lines.push(`- Regression check on v${e.version}: held-out loss ${e.baseLoss.toFixed(4)} → ${e.newLoss.toFixed(4)} over ${e.evalSize} prior task(s) (${dir})`);
  }
  return lines;
}

/**
 * The test-bench run — the section that actually carries the evidence. Each sample
 * reports the verdict the SERVE PATH reached, the signal that rejected it, and the
 * raw bytes verbatim. A refusal reason without the output it refused is unactionable,
 * and the output without the reason is just noise.
 */
function probeSection(p: EvermindProbeResult): string[] {
  const passed = p.samples.filter((s) => s.coherent).length;
  const lines = [
    '## Test bench',
    '',
    `- Run: ${p.mode === 'readiness' ? 'readiness suite (the gate for switching replies on)' : 'operator prompt'}`,
    `- Model version: v${p.version}`,
    `- Verdict: ${p.ready ? 'WOULD SERVE' : 'REFUSED'}`,
    `- Usable answers: ${passed} of ${p.samples.length} (pass rate ${Math.round(p.passRate * 100)}%)`,
    '',
  ];
  p.samples.forEach((s, i) => {
    lines.push(`### Sample ${i + 1} — ${s.coherent ? 'USABLE' : 'REFUSED'}`);
    lines.push('');
    lines.push(`Prompt: ${s.prompt}`);
    if (!s.coherent) lines.push(`Rejected by: \`${s.failure ?? 'unknown'}\` — ${s.detail || 'no detail'}`);
    lines.push('');
    lines.push('Raw output (verbatim):');
    lines.push(fence(clamp(s.text, MAX_OUTPUT_CHARS)));
    lines.push('');
  });
  return lines;
}

/** The knowledge audit — what was learned that shouldn't have been. */
function analysisSection(a: EvermindKnowledgeAnalysis): string[] {
  const lines = [
    '## Knowledge audit',
    '',
    `- Memories reviewed: ${a.analyzed}`,
    `- Graded by: ${a.model ?? 'local coherence screen only (no frontier reviewer)'}`,
    `- Findings: ${a.findings.length}`,
  ];
  if (a.warning) lines.push(`- Partial audit: ${a.warning}`);
  lines.push('');
  if (a.findings.length === 0) {
    lines.push('Nothing flagged.');
    lines.push('');
    return lines;
  }
  for (const f of a.findings.slice(0, MAX_FINDINGS)) {
    lines.push(`### Memory #${f.id} — ${f.verdict} (${f.source})`);
    lines.push('');
    if (f.prompt) lines.push(`Task: ${f.prompt}`);
    lines.push(`Issue: ${f.issue}`);
    lines.push('');
    lines.push('As learned:');
    lines.push(fence(clamp(f.excerpt, MAX_EXCERPT_CHARS)));
    if (f.correction) {
      lines.push('');
      lines.push('Proposed correction:');
      lines.push(fence(clamp(f.correction, MAX_EXCERPT_CHARS)));
    }
    lines.push('');
  }
  if (a.findings.length > MAX_FINDINGS) {
    lines.push(`_…and ${a.findings.length - MAX_FINDINGS} more finding(s) not included._`);
    lines.push('');
  }
  return lines;
}

/** Everminds under this project — catches the "I trained the wrong one" class of bug,
 *  which is invisible from a screenshot of a single head. */
function targetsSection(targets: EvermindTarget[]): string[] {
  const lines = ['## Everminds under this project', ''];
  targets.forEach((tg, i) => {
    const state = [
      tg.seeded ? `v${tg.version}` : 'not seeded',
      tg.mode === 'connected' ? 'connected' : 'frozen',
      tg.inferenceEnabled ? 'serving replies' : 'not serving',
    ].join(', ');
    lines.push(`- ${i === 0 ? '[this project]' : '[IDE build]'} ${tg.name} (project #${tg.projectId}) — ${state}`);
  });
  lines.push('');
  return lines;
}

/** The tail of the learn log — what went in most recently, which is usually what
 *  broke it. Deltas carry no text, so they report as the weight contributions they are. */
function recentSection(d: EvermindConsoleData): string[] {
  const entries = d.recent.slice(0, MAX_RECENT);
  const lines = [`## Recently learned (${entries.length} of ${d.recent.length} shown)`, ''];
  if (entries.length === 0) {
    lines.push('Nothing learned yet.');
    lines.push('');
    return lines;
  }
  for (const e of entries) {
    const when = new Date(e.at).toISOString();
    const status = evermindLearnedStatus(e);
    const provenance = status.state === 'distilled'
      ? `distilled by ${status.teacherModel ?? 'a teacher'}`
      : status.state === 'fault'
        ? `NOT distilled (${status.reason}${status.detail ? `: ${status.detail}` : ''})`
        : status.state === 'self' ? 'self-learned from run output' : 'weight delta';
    lines.push(`- v${e.version} ×${e.weight} ${when} [${e.kind}] ${provenance}`);
    if (e.prompt) lines.push(`  - task: ${clamp(e.prompt, 200)}`);
    if (e.text) lines.push(`  - learned: ${clamp(e.text, 300).replace(/\n/g, ' ')}`);
  }
  lines.push('');
  return lines;
}

/**
 * Build the report. Every section is optional except the header — a console that
 * failed to load still produces a useful document (that failure IS the diagnosis),
 * which is exactly when an operator most wants to hand something over.
 */
export function buildEvermindDiagnostics(input: EvermindDiagnosticsInput): string {
  const { data, projectName, host, targets, probe, analysis, error, now } = input;
  const lines: string[] = [
    `# Evermind diagnostics${projectName ? ` — ${projectName}` : ''}`,
    '',
    `- Generated: ${new Date(now).toISOString()}`,
    `- Surface: ${host === 'vscode' ? 'VS Code sidebar' : 'web console'}`,
    '',
  ];

  if (error) {
    lines.push('## Last error', '', error, '');
  }

  if (!data) {
    lines.push('## Model state', '', 'The console could not load this project’s Evermind — no head state is available.', '');
    return lines.join('\n');
  }

  lines.push(...headSection(data), '');
  const next = evermindNextAction({
    seeded: data.seeded,
    inferenceEnabled: data.inferenceEnabled,
    mode: data.mode,
    pending: data.pending,
    teacherModel: data.teacherModel,
    quarantinedAt: data.quarantinedAt,
    recent: data.recent,
    eval: data.eval,
    probe,
  });
  lines.push('## Recommended next action', '', `- ${next.title}`, `- Why: ${next.detail}`, `- Go to: ${next.destination}`, '');
  if (targets && targets.length > 0) lines.push(...targetsSection(targets));
  if (probe) lines.push(...probeSection(probe));
  else lines.push('## Test bench', '', '_Not run in this session — run one before exporting to include what the model actually produces._', '');
  if (analysis) lines.push(...analysisSection(analysis));
  lines.push(...recentSection(data));

  return lines.join('\n');
}
