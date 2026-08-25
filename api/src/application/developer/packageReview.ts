/**
 * Static review — the gate every submitted version passes before it can be
 * installed by anyone.
 *
 * PRD 24 §5.5 stages review as static → dynamic → agentic → human. This is stage
 * one, and it runs SYNCHRONOUSLY on submit: a publisher gets the verdict while
 * they are still looking at the form, which is the difference between a review
 * pipeline people use and one they wait on.
 *
 * ── WHY THE VERDICT IS A LIST, NOT A BOOLEAN ────────────────────────────────
 * Every check records a finding whether it passed or failed, and the whole list
 * is stored on `extension_versions.review_findings`. An approval nobody can
 * reconstruct is not an audit trail, and the first time a bad package gets
 * through, the question will be "which checks ran?" — not "did it pass?".
 *
 * ── FAIL CLOSED ─────────────────────────────────────────────────────────────
 * A kind with no validator is REJECTED, never waved through. `EXTENSION_KINDS`
 * declares seven kinds and `SUBMITTABLE_KINDS` opens two; the gap between those
 * lists is exactly the set this refuses, and it refuses by construction rather
 * than by anybody remembering to add a branch.
 */

import {
  isExtensionScope,
  mayCharge,
  SENSITIVE_SCOPES,
  SUBMITTABLE_KINDS,
  type PublisherState,
  type ExtensionKind,
} from './extensionContract';
import { parseConnectorManifest, type ConnectorManifest } from '../connectors/connectorManifest';
import { isReservedConnectorKey } from '../connectors/defaults';
import { assertSafeUrl } from '../../infrastructure/net/ssrfGuard';

export type FindingSeverity = 'pass' | 'warn' | 'fail';

export interface ReviewFinding {
  /** Stable machine name — what a dashboard groups by and a re-review compares against. */
  check: string;
  severity: FindingSeverity;
  message: string;
}

export interface ReviewOutcome {
  approved: boolean;
  findings: ReviewFinding[];
  /** The spec as the platform will store it — normalised by the kind's own parser. */
  normalizedSpec: Record<string, unknown>;
  /** Scopes kept after filtering to the vocabulary. */
  scopes: string[];
}

export class PackageReviewError extends Error {
  constructor(public readonly findings: ReviewFinding[]) {
    super(findings.filter((f) => f.severity === 'fail').map((f) => f.message).join('; ') || 'review failed');
    this.name = 'PackageReviewError';
  }
}

const pass = (check: string, message: string): ReviewFinding => ({ check, severity: 'pass', message });
const warn = (check: string, message: string): ReviewFinding => ({ check, severity: 'warn', message });
const fail = (check: string, message: string): ReviewFinding => ({ check, severity: 'fail', message });

/**
 * Anything that looks like a live credential baked into the submitted spec.
 *
 * A manifest carries auth FIELD DECLARATIONS, never auth VALUES — values live
 * encrypted on the connection row. So a token-shaped string anywhere in the spec
 * is either a publisher leaking their own secret into a public listing or an
 * attempt to ship a hard-coded key, and both are refusals.
 */
const SECRET_PATTERNS: ReadonlyArray<{ label: string; re: RegExp }> = [
  { label: 'AWS access key id',      re: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: 'GitHub token',           re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { label: 'Slack token',            re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { label: 'Stripe secret key',      re: /\bsk_(live|test)_[A-Za-z0-9]{16,}\b/ },
  { label: 'OpenAI-style key',       re: /\bsk-[A-Za-z0-9]{32,}\b/ },
  { label: 'Google API key',         re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { label: 'private key block',      re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { label: 'BuilderForce API key',   re: /\bbf(k|ai)_[A-Za-z0-9]{16,}\b/ },
];

function scanForSecrets(spec: unknown): ReviewFinding {
  const serialized = JSON.stringify(spec ?? {});
  for (const { label, re } of SECRET_PATTERNS) {
    if (re.test(serialized)) {
      return fail('secret_scan', `spec contains what looks like a ${label} — credentials are supplied at install time, never in a manifest`);
    }
  }
  return pass('secret_scan', 'no credential-shaped literals in the spec');
}

/** A `connector` spec is a connector manifest, validated by the manifest's own parser. */
function reviewConnectorSpec(spec: unknown, findings: ReviewFinding[]): Record<string, unknown> | null {
  let manifest: ConnectorManifest;
  try {
    manifest = parseConnectorManifest(spec);
  } catch (error) {
    findings.push(fail('manifest_parse', error instanceof Error ? error.message : 'manifest is not valid'));
    return null;
  }
  findings.push(pass('manifest_parse', `manifest parsed — ${manifest.actions.length} action(s)`));

  // A published key that collides with a built-in would shadow Slack or GitHub
  // for every tenant that installed it. The tenant-authored path already refuses
  // this; the published path must refuse it harder, because the blast radius is
  // the whole platform rather than one workspace.
  if (isReservedConnectorKey(manifest.key)) {
    findings.push(fail('reserved_key', `connector key "${manifest.key}" is reserved by a built-in connector`));
  } else {
    findings.push(pass('reserved_key', `connector key "${manifest.key}" is available`));
  }

  if (manifest.actions.length === 0) {
    findings.push(fail('actions_declared', 'a connector with no actions gives an agent nothing to call'));
  }

  const undocumented = manifest.actions.filter((a) => !a.description?.trim());
  if (undocumented.length > 0) {
    // A tool with no description is a tool the model will not call correctly.
    findings.push(warn('action_descriptions', `${undocumented.length} action(s) have no description — agents choose tools by their description`));
  } else {
    findings.push(pass('action_descriptions', 'every action is described'));
  }

  return manifest as unknown as Record<string, unknown>;
}

/** An `mcp_server` spec is a URL the gateway will relay to, plus a declared tool list. */
function reviewMcpSpec(spec: unknown, findings: ReviewFinding[]): Record<string, unknown> | null {
  if (typeof spec !== 'object' || spec === null || Array.isArray(spec)) {
    findings.push(fail('spec_shape', 'spec must be a JSON object'));
    return null;
  }
  const raw = spec as Record<string, unknown>;
  const serverUrl = String(raw.serverUrl ?? '').trim();
  if (!serverUrl) {
    findings.push(fail('server_url', 'serverUrl is required'));
    return null;
  }
  try {
    // The same guard the tenant-registered MCP path uses. Author-time only —
    // `mcpExtensionService` re-resolves the hostname before every call, which is
    // what actually defeats DNS rebinding.
    assertSafeUrl(serverUrl, { allowHttp: false });
    findings.push(pass('server_url', `${serverUrl} is a public https endpoint`));
  } catch (error) {
    findings.push(fail('server_url', `serverUrl: ${error instanceof Error ? error.message : 'invalid'}`));
    return null;
  }

  const declared = Array.isArray(raw.tools) ? raw.tools : [];
  if (declared.length === 0) {
    findings.push(fail('tools_declared', 'declare the tools this server exposes — an undeclared tool cannot be reviewed'));
  } else {
    findings.push(pass('tools_declared', `${declared.length} tool(s) declared`));
  }

  if (raw.secret !== undefined || raw.token !== undefined) {
    findings.push(fail('no_inline_secret', 'the bearer secret is supplied by the installing tenant, never by the publisher'));
  }

  return {
    serverUrl,
    tools: declared,
    authKind: raw.authKind === 'bearer' ? 'bearer' : 'none',
  };
}

export interface ReviewInput {
  kind: ExtensionKind;
  spec: unknown;
  requestedScopes: readonly string[];
  /** The publisher's trust tier at submit time. */
  verificationState: PublisherState | string;
  /** True when the package is (or is becoming) a PAID listing. */
  paid: boolean;
  /** The previously approved version's scopes, when there is one. */
  previousScopes?: readonly string[] | null;
}

/**
 * Run every static check. Never throws — the caller decides what a failure means
 * (a submit rejects; a re-review of a live version records and alerts).
 */
export function reviewVersion(input: ReviewInput): ReviewOutcome {
  const findings: ReviewFinding[] = [];

  // ── Kind ────────────────────────────────────────────────────────────────
  if (!SUBMITTABLE_KINDS.includes(input.kind)) {
    findings.push(fail('kind_open', `packages of kind "${input.kind}" are declared but not open for submission yet`));
    return { approved: false, findings, normalizedSpec: {}, scopes: [] };
  }
  findings.push(pass('kind_open', `"${input.kind}" is open for submission`));

  // ── Secrets ─────────────────────────────────────────────────────────────
  findings.push(scanForSecrets(input.spec));

  // ── Spec, by kind ───────────────────────────────────────────────────────
  const normalizedSpec =
    input.kind === 'connector'
      ? reviewConnectorSpec(input.spec, findings)
      : reviewMcpSpec(input.spec, findings);

  // ── Scopes ──────────────────────────────────────────────────────────────
  const unknownScopes = input.requestedScopes.filter((s) => !isExtensionScope(s));
  if (unknownScopes.length > 0) {
    findings.push(fail('scope_vocabulary', `unknown scope(s): ${unknownScopes.join(', ')}`));
  }
  const scopes = input.requestedScopes.filter(isExtensionScope);
  if (scopes.length === 0) {
    findings.push(fail('scope_declared', 'declare at least one scope — an extension that asks for nothing can do nothing'));
  } else {
    findings.push(pass('scope_declared', `requests ${scopes.length} scope(s)`));
  }

  const sensitive = scopes.filter((s) => SENSITIVE_SCOPES.includes(s));
  if (sensitive.length > 0) {
    // Not a failure. A write scope is legitimate — it just can never be granted
    // by an auto-update, and the install screen has to say so out loud.
    findings.push(warn('sensitive_scopes', `writes customer data (${sensitive.join(', ')}) — installs and upgrades always prompt`));
  }

  const widened = scopes.filter((s) => !(input.previousScopes ?? []).includes(s));
  if (input.previousScopes && widened.length > 0) {
    findings.push(warn('scope_widened', `widens on the previous version (${widened.join(', ')}) — existing installs will re-prompt`));
  }

  // ── Verification gate on money ──────────────────────────────────────────
  // PRD 24 §9, decision 2: identity verification is what lets a publisher charge.
  // Checked here rather than at checkout because the honest moment to refuse is
  // before a price is advertised, not after a customer tries to pay it.
  if (input.paid && !mayCharge(String(input.verificationState))) {
    findings.push(fail('paid_requires_identity', 'a paid listing requires an identity-verified publisher'));
  } else if (input.paid) {
    findings.push(pass('paid_requires_identity', 'publisher is identity-verified'));
  }

  const approved = normalizedSpec !== null && !findings.some((f) => f.severity === 'fail');
  return { approved, findings, normalizedSpec: normalizedSpec ?? {}, scopes };
}
