/**
 * BackendHostingStrategy — the port for "where does this project's server-side
 * half actually run?".
 *
 * The platform could publish a project's FRONT end (static assets to R2, served
 * at `<sub>.builderforce.ai`) but had nowhere to run a request handler. Every
 * system worth building for a real brief is webhook-driven, so that gap was the
 * difference between "we generated you an app" and "we generated you a working
 * system".
 *
 * There are two honest answers to where a handler runs, with genuinely different
 * trade-offs, and a customer should not have to pick one before they have
 * anything working:
 *
 *   `declarative`   — the handler is data in the canvas, executed by THIS worker
 *                     at a public ingress URL. Live the instant it is saved: no
 *                     cloud account, no CLI, no card. Bounded by a step
 *                     vocabulary, because running customer-authored code in a
 *                     shared isolate is not something you can make safe.
 *
 *   `github-worker` — the same handlers COMPILED to a real Cloudflare Worker in
 *                     the customer's own repo, deployed by a generated Action to
 *                     their own account. No vocabulary limit, their logs, their
 *                     scale, their bill. Costs them a Cloudflare API token.
 *
 * The port exists so the expensive, security-sensitive parts — the ingress, the
 * secret vault, signature verification, the handler spec itself — are written
 * ONCE and shared. No adapter is throwaway.
 *
 * There are three more, and they exist for a reason that is not technical:
 *
 *   `aws-lambda`      — the same handlers AND the project's own site, deployed
 *   `gcp-cloudrun`      into the customer's own AWS / Google Cloud / Azure
 *   `azure-functions`   account. "It runs on our platform" is not an acceptable
 *                       answer to a procurement question about data residency,
 *                       an existing enterprise agreement, or a security review
 *                       that only knows how to audit one provider. All four
 *                       self-hosted adapters embed ONE generated engine
 *                       (`handlerEngineSource.ts`), so the semantics cannot
 *                       drift between clouds.
 */

import type { ConnectorManifest } from '../connectors/connectorManifest';
import type { HandlerSpec } from './handlerSpec';

export const BACKEND_STRATEGIES = [
  'declarative',
  'github-worker',
  'aws-lambda',
  'gcp-cloudrun',
  'azure-functions',
] as const;
export type BackendStrategyKey = (typeof BACKEND_STRATEGIES)[number];

export function isBackendStrategy(v: unknown): v is BackendStrategyKey {
  return typeof v === 'string' && (BACKEND_STRATEGIES as readonly string[]).includes(v);
}

/** A remaining human action before the backend is live and reachable. */
export interface SetupStep {
  /** Stable id so the UI can mark one done without matching on prose. */
  key: string;
  label: string;
  detail: string;
  /** Where the user performs it, when it is outside Builderforce. */
  url?: string;
  /** True when the platform cannot proceed until a human does this. */
  blocking: boolean;
}

export interface MaterializeContext {
  projectId: number;
  tenantId: number;
  projectName: string;
  /** Public base the declarative ingress serves this project at. */
  ingressUrl: string;
  /** Handlers currently authored in the canvas. */
  handlers: readonly HandlerSpec[];
  /**
   * Manifests for every connector the handlers call. A manifest carries NO
   * credentials (those live on the connection row), so it is safe to hand to an
   * adapter that will write it into the customer's repo — and it is what lets the
   * generated Worker make the same calls we do without importing our runtime.
   */
  connectors: readonly ConnectorManifest[];
  /** Secret NAMES the project has stored. Values never cross this boundary. */
  secretNames: readonly string[];
  /** Secret names the handlers/blueprint require, whether or not they are set. */
  requiredSecretNames: readonly string[];
  /** This API's public origin, for generated code that calls back. */
  apiOrigin: string;
}

export interface MaterializeResult {
  /** Files to write into the canvas (R2). Empty when nothing is generated. */
  files: Record<string, string>;
  /** What the user still has to do. Ordered; blocking steps first. */
  setupSteps: SetupStep[];
  /** Base URL to point provider webhooks at, once setup is complete. */
  webhookBaseUrl: string | null;
}

export interface BackendHostingStrategy {
  key: BackendStrategyKey;
  label: string;
  summary: string;
  /** True when saving a handler is sufficient for it to be live. */
  zeroSetup: boolean;
  materialize(ctx: MaterializeContext): MaterializeResult;
}

/** Missing-secret setup steps, shared by every adapter (they all need the same
 *  credentials present before the system can do anything). */
export function missingSecretSteps(ctx: MaterializeContext): SetupStep[] {
  const have = new Set(ctx.secretNames);
  return ctx.requiredSecretNames
    .filter((name) => !have.has(name))
    .map((name) => ({
      key: `secret:${name}`,
      label: `Add the ${name} secret`,
      // The gateway key gets its own sentence because the wrong key is the easy
      // mistake: an agent-host credential looks like an API key, is refused by the
      // gateway, and used to surface as model steps that silently produced nothing.
      detail: name === 'BUILDERFORCE_API_KEY'
        ? `This project's backend calls models through the Builderforce gateway. Create a WORKSPACE API key (Settings ▸ API Keys — it starts with \`bfk_\`) and store it as ${name} in the project's secret vault. An agent-host key will be refused. The vault is sealed per tenant and is never returned to the browser.`
        : `This project's backend needs ${name}. Store it in the project's secret vault — it is sealed per tenant and is never returned to the browser.`,
      blocking: true,
    }));
}
