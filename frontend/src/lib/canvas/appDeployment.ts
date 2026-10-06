/**
 * A published app, as a DEPLOYMENT CARD on its board.
 *
 * The App surface's Publish panel puts the app's site on the web, and before this the
 * board never heard about it: phase readiness, the Operate surface and the room's ops
 * station all read "live" off a `deployment` card (`isLiveDeployment`), so a canvas whose
 * app was live kept saying "There's an app but nothing deployed". This is the one rule
 * that turns a published site into that card.
 *
 * The card belongs to its app by a connection (app → deployment), not by a field: the
 * board already says which object delivered which, and a second copy of that link would
 * drift the first time someone redraws it. Re-publishing updates the same card — one card
 * per app, carrying the latest address and version — rather than stacking a card per push.
 *
 * Pure: the caller (`useRecordAppDeployments`) places, connects and announces.
 */
import { DEPLOYMENT_KIND } from './boardDeployments';

/** What a publish (or a site that is already live) says about where the app runs. */
export interface PublishedAppSite {
  url: string;
  versionToken?: string | null;
  /** ISO instant; the caller's clock when the site does not say. */
  publishedAt?: string | null;
}

/** The environment a site publish lands in — the app's one public address. */
export const APP_SITE_ENVIRONMENT = 'production';

export type AppDeploymentChange =
  | { type: 'update'; deploymentId: string; patch: Record<string, unknown> }
  | { type: 'create'; data: Record<string, unknown> };

interface BoardNode { id: string; data: Readonly<Record<string, unknown>> }
interface BoardEdge { source: string; target: string }

/** The deployment card connected to `appNodeId`, either way round, or null. */
export function appDeploymentNode<N extends BoardNode>(nodes: readonly N[], edges: readonly BoardEdge[], appNodeId: string): N | null {
  const linked = new Set(edges.flatMap((edge) => (edge.source === appNodeId ? [edge.target] : edge.target === appNodeId ? [edge.source] : [])));
  return nodes.find((node) => linked.has(node.id) && node.data.kind === DEPLOYMENT_KIND) ?? null;
}

/**
 * The change that records `site` for the app `appNodeId`, or null when the board already
 * says exactly this (same address, same version) — so recording a site that is already
 * on the board, on every load, writes nothing.
 */
export function appDeploymentChange(
  nodes: readonly BoardNode[],
  edges: readonly BoardEdge[],
  appNodeId: string,
  site: PublishedAppSite,
  context: { now: string; title: string },
): AppDeploymentChange | null {
  const url = site.url.trim();
  if (!url) return null;
  const version = site.versionToken?.trim() || null;
  const fields = {
    url,
    environmentName: APP_SITE_ENVIRONMENT,
    deployedAt: site.publishedAt || context.now,
    status: 'live',
    ...(version ? { version } : {}),
  };
  const existing = appDeploymentNode(nodes, edges, appNodeId);
  if (!existing) return { type: 'create', data: { kind: DEPLOYMENT_KIND, title: context.title, ...fields } };
  if (existing.data.url === url && (version === null || existing.data.version === version)) return null;
  return { type: 'update', deploymentId: existing.id, patch: fields };
}
