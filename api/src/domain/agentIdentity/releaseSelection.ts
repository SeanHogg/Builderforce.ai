export function selectAgentRelease(
  executionId: number,
  release: { stableVersionId: string; canaryVersionId: string | null; canaryPercent: number },
): string {
  const percent = Math.min(100, Math.max(0, Math.trunc(release.canaryPercent)));
  return release.canaryVersionId && Math.abs(Math.trunc(executionId)) % 100 < percent
    ? release.canaryVersionId
    : release.stableVersionId;
}
