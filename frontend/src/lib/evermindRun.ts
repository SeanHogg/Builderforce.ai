/**
 * Detect whether a run executed ON a project's own self-learning Evermind, and at
 * which head version — read from the run's served-model telemetry (the `llm.complete`
 * model strings), NOT from the request, so it reflects what actually ran.
 *
 * A project-Evermind ref carries its version as a trailing `/v<N>` segment
 * (`evermind/project/<tenant>/<project>/v<N>`), possibly logged with a doubled
 * `evermind/` prefix by the in-Worker vendor and/or a `×<count>` step suffix — both
 * tolerated by the match. Any model string containing `evermind/` counts as an
 * Evermind run; the version is 0 when it can't be parsed (still an Evermind run).
 *
 * Shared by the per-run provenance chip (AgentExecutionPanel) and any surface that
 * wants to flag an Evermind run (Observability), so the detection rule lives once.
 */
export function detectEvermindRun(models: readonly string[]): { version: number } | null {
  for (const m of models) {
    if (!m.includes('evermind/')) continue;
    const match = m.match(/\/v(\d+)\b/);
    return { version: match ? Number(match[1]) : 0 };
  }
  return null;
}
