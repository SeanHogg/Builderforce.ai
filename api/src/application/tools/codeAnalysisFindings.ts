import type { CodeAnalysisSnapshot } from '@builderforce/agent-tools';
import type { AuditFinding } from './auditDeepPass';
/** Analyzer evidence also enters the remediation pipeline; a narrative cannot silently omit it. */
export function codeAnalysisFindings(snapshot?: CodeAnalysisSnapshot): AuditFinding[] {
  return snapshot?.issues.map((issue) => ({
    title: `${issue.kind}: ${issue.symbol ?? issue.locations.map((l) => l.path).join(' ↔ ')}`,
    severity: issue.kind === 'duplicate' ? 'medium' : 'low',
    location: `${issue.locations[0]!.path}:${issue.locations[0]!.startLine}`,
    detail: issue.locations.map((l) => `${l.path}:${l.startLine}-${l.endLine}`).join('\n'),
    recommendation: issue.kind === 'duplicate'
      ? 'Review these matching blocks, consolidate shared behavior where appropriate, and verify the change with tests and a new analysis snapshot.'
      : 'Verify this unused-code candidate against dynamic imports, public APIs, framework entry points and runtime behavior before removing it. Rerun the analyzer and relevant tests.',
  })) ?? [];
}
