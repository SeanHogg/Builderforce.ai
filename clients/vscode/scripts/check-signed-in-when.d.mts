export interface SignedInClause { owner: string | undefined; clause: string; at: string }
export const SIGNED_IN_ALLOWLIST: readonly string[];
export function signedInClauses(node: unknown, trail?: string): SignedInClause[];
export function signedInViolations(manifest: unknown, allowlist?: readonly string[]): SignedInClause[];
