import { describe, expect, it } from 'vitest';
import { buildEvermindDiagnostics } from './diagnosticsReport';
import type { EvermindConsoleData, EvermindKnowledgeAnalysis, EvermindProbeResult } from './types';

const NOW = Date.UTC(2026, 6, 26, 12, 0, 0);

function head(over: Partial<EvermindConsoleData> = {}): EvermindConsoleData {
  return {
    version: 1140,
    seeded: true,
    mode: 'connected',
    contributions: 1837,
    inferenceEnabled: true,
    teacherModel: null,
    lastLearnedAt: '2026-07-26T11:57:00.000Z',
    pending: 0,
    recent: [],
    ...over,
  };
}

describe('buildEvermindDiagnostics', () => {
  it('reports the head state an operator would otherwise have to screenshot', () => {
    const report = buildEvermindDiagnostics({ data: head(), host: 'web', projectName: 'EverMind', now: NOW });
    expect(report).toContain('# Evermind diagnostics — EverMind');
    expect(report).toContain('2026-07-26T12:00:00.000Z');
    expect(report).toContain('- Version: v1140');
    expect(report).toContain('- Learning: connected');
    expect(report).toContain('- Serving replies (inference): ON');
    expect(report).toContain('- Learned contributions: 1837');
  });

  it('carries the model’s RAW output verbatim — the evidence a screenshot loses', () => {
    // The exact bytes are the bug report. If the export normalises them, the reader is
    // debugging a description of the failure instead of the failure.
    const gibberish = ':��p� retur+�9��<|endoftext|>';
    const probe: EvermindProbeResult = {
      version: 1140,
      mode: 'readiness',
      ready: false,
      passRate: 0,
      samples: [{
        prompt: 'Summarize the current status of the project.',
        text: gibberish,
        coherent: false,
        failure: 'replacement-chars',
        detail: 'the output contains Unicode replacement characters (broken token decoding)',
      }],
    };
    const report = buildEvermindDiagnostics({ data: head(), host: 'web', probe, now: NOW });
    expect(report).toContain(gibberish);
    expect(report).toContain('Rejected by: `replacement-chars`');
    expect(report).toContain('broken token decoding');
    expect(report).toContain('- Verdict: REFUSED');
    expect(report).toContain('- Usable answers: 0 of 1');
  });

  it('says so when no test bench was run, instead of implying the model was checked', () => {
    const report = buildEvermindDiagnostics({ data: head(), host: 'vscode', now: NOW });
    expect(report).toContain('_Not run in this session');
    expect(report).toContain('- Surface: VS Code sidebar');
  });

  it('reports quarantine, inheritance and a regression together — the three states that explain a model nobody switched off', () => {
    const report = buildEvermindDiagnostics({
      data: head({
        quarantinedAt: '2026-07-26T09:00:00.000Z',
        quarantineReason: '3 incoherent serves',
        inherited: true,
        inheritedFromProjectId: 30,
        eval: { version: 1140, at: NOW, baseLoss: 4.5, newLoss: 4.9, delta: -0.4, evalSize: 12 },
      }),
      host: 'web',
      now: NOW,
    });
    expect(report).toContain('QUARANTINED at 2026-07-26T09:00:00.000Z — 3 incoherent serves');
    expect(report).toContain('INHERITED from project #30');
    expect(report).toContain('REGRESSED');
  });

  it('includes audit findings with their corrections', () => {
    const analysis: EvermindKnowledgeAnalysis = {
      version: 1140,
      analyzed: 40,
      model: 'claude-opus-5',
      findings: [{
        id: 12,
        verdict: 'incorrect',
        issue: 'States the API deploys to Vercel; it deploys to Cloudflare Workers.',
        prompt: 'Where does the API deploy?',
        excerpt: 'The API deploys to Vercel.',
        correction: 'The API deploys to Cloudflare Workers.',
        source: 'frontier',
      }],
    };
    const report = buildEvermindDiagnostics({ data: head(), host: 'web', analysis, now: NOW });
    expect(report).toContain('### Memory #12 — incorrect (frontier)');
    expect(report).toContain('Proposed correction:');
    expect(report).toContain('The API deploys to Cloudflare Workers.');
    expect(report).toContain('- Graded by: claude-opus-5');
  });

  it('marks truncation rather than silently cutting — an early stop IS a symptom', () => {
    const long = 'x'.repeat(5000);
    const report = buildEvermindDiagnostics({
      data: head(),
      host: 'web',
      probe: {
        version: 1, mode: 'prompt', ready: true, passRate: 1,
        samples: [{ prompt: 'p', text: long, coherent: true, failure: null, detail: '' }],
      },
      now: NOW,
    });
    expect(report).toContain('…[truncated 3800 more characters]');
  });

  it('still produces a usable report when the console never loaded', () => {
    // The load failure IS the diagnosis, and it is exactly when an operator most wants
    // to hand something over — so this path must not produce an empty document.
    const report = buildEvermindDiagnostics({ data: null, host: 'web', error: 'HTTP 403', now: NOW });
    expect(report).toContain('## Last error');
    expect(report).toContain('HTTP 403');
    expect(report).toContain('could not load');
  });

  it('names every Evermind under the project, so training the wrong one is visible', () => {
    const report = buildEvermindDiagnostics({
      data: head(),
      host: 'web',
      targets: [
        { projectId: 30, name: 'EverMind', version: 1140, mode: 'connected', inferenceEnabled: true, seeded: true },
        { projectId: 41, name: 'Sibling build', version: 0, mode: 'offline-frozen', inferenceEnabled: false, seeded: false },
      ],
      now: NOW,
    });
    expect(report).toContain('[this project] EverMind (project #30) — v1140, connected, serving replies');
    expect(report).toContain('[IDE build] Sibling build (project #41) — not seeded, frozen, not serving');
  });

  it('reports a teacher fault in the learn log — a taught task that learned nothing', () => {
    const report = buildEvermindDiagnostics({
      data: head({
        recent: [{
          id: 1, kind: 'text', version: 1140, at: NOW, weight: 1,
          prompt: 'Tag each feature', text: 'Tag each feature as shipped…',
          skipReason: 'teacher-error', skipDetail: 'HTTP 429',
        }],
      }),
      host: 'web',
      now: NOW,
    });
    expect(report).toContain('NOT distilled (teacher-error: HTTP 429)');
    expect(report).toContain('task: Tag each feature');
  });
});
