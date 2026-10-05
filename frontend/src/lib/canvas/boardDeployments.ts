/**
 * The board's DEPLOYMENTS — the one reader of `deployment` objects.
 *
 * A `deployment` card carries `environmentName`, `version`, `url`, `deployedAt` and
 * `deployedBy` (`creationObjectRegistry.ts`). Three things read them: phase readiness
 * ("is this canvas live?"), the room's ops station and the Operate surface. They all ask
 * here, so "live" means one thing everywhere: a deployment with an address. A deployment
 * card with no url is a plan, not a running thing.
 *
 * Pure: no React, no I/O.
 */

export const DEPLOYMENT_KIND = 'deployment';

export interface BoardDeployment {
  id: string;
  title: string;
  environment: string | null;
  version: string | null;
  url: string | null;
  /** ISO instant, or null when the card never said. */
  deployedAt: string | null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** THE live predicate. */
export function isLiveDeployment(data: Readonly<Record<string, unknown>>): boolean {
  return data.kind === DEPLOYMENT_KIND && text(data.url) !== null;
}

/** Every deployment on the board, newest first; undated ones after every dated one. */
export function boardDeployments(nodes: ReadonlyArray<{ id: string; data: Readonly<Record<string, unknown>> }>): BoardDeployment[] {
  const out = nodes
    .filter((node) => node.data.kind === DEPLOYMENT_KIND)
    .map((node) => ({
      id: node.id,
      title: text(node.data.title) ?? '',
      environment: text(node.data.environmentName),
      version: text(node.data.version),
      url: text(node.data.url),
      deployedAt: text(node.data.deployedAt),
    }));
  const at = (value: string | null) => (value ? Date.parse(value) : Number.NaN);
  return out
    .map((deployment, index) => ({ deployment, index }))
    .sort((a, b) => {
      const x = at(a.deployment.deployedAt);
      const y = at(b.deployment.deployedAt);
      if (!Number.isNaN(x) && !Number.isNaN(y) && x !== y) return y - x;
      if (Number.isNaN(x) !== Number.isNaN(y)) return Number.isNaN(x) ? 1 : -1;
      return a.index - b.index;
    })
    .map(({ deployment }) => deployment);
}
