/**
 * The workspace scan's run (PRD 41 A4): the deterministic part ALWAYS runs. Only the optional
 * overview needs a model route; with none (no local model, no specific model, no key for a route
 * that needs sign-in) the overview is omitted and marked `skipped / no-model-route`, and the
 * agent is grounded on the deterministic map. There are no early returns before the scan.
 *
 * One scan per root at a time: a call while one runs coalesces onto it, and a FORCED call queues at most
 * one trailing forced scan (every further forced call shares it).
 *
 * Ports are injected so the signed-out path is testable without the extension host.
 */

import type { ModelRoute } from "./modelRouting";
import type { ScanResult } from "./codebaseScan";

export interface WorkspaceScanPorts {
  /** The first workspace folder's fs path, if any. */
  root(): string | undefined;
  registerWorkspace(root: string): void;
  refreshSymbolIndex(root: string): Promise<void>;
  policyResolved(): Promise<void>;
  /** The editor key, if signed in. */
  key(): Promise<string | undefined>;
  resolveRoute(): Promise<ModelRoute>;
  /** Why the route cannot serve the overview for a reason signing in will not fix, or null. */
  noModelReason(route: ModelRoute): "no_local_model" | "no_specific_model" | null;
  routeRequiresSignIn(route: ModelRoute): boolean;
  promptNoModel(reason: "no_local_model" | "no_specific_model"): void;
  scan(root: string, route: ModelRoute | null, force: boolean): Promise<ScanResult>;
  setGrounding(grounding: string): void;
  /** The `sync` capability (a session AND the `synchronize` grant): the only state that may publish the digest. */
  syncAllowed(): boolean;
  /** Publishes the digest to the project; only meaningful (and only attempted) when {@link syncAllowed}. */
  afterScan(root: string, scan: ScanResult): Promise<void>;
  withProgress(title: string, work: () => Promise<void>): Promise<void>;
  info(message: string): void;
  error(message: string, e: unknown): void;
}

interface Flight {
  done: Promise<void>;
  /** The one forced scan queued behind this one. */
  trailing?: Promise<void>;
}
const flights = new Map<string, Flight>();

function launch(root: string, ports: WorkspaceScanPorts, force: boolean): Promise<void> {
  const flight: Flight = { done: Promise.resolve() };
  flight.done = scanOnce(root, ports, force).finally(() => { if (flights.get(root) === flight) flights.delete(root); });
  flights.set(root, flight);
  return flight.done;
}

export function runWorkspaceScan(ports: WorkspaceScanPorts, force: boolean): Promise<void> {
  const root = ports.root();
  if (!root) return Promise.resolve();
  const running = flights.get(root);
  if (!running) return launch(root, ports, force);
  if (!force) return running.done;
  running.trailing ??= running.done.then(() => launch(root, ports, true));
  return running.trailing;
}

/** True when a cached scan skipped the overview for want of a route (it is stale once a route is usable). */
function skippedForNoRoute(scan: ScanResult): boolean {
  return scan.overviewStatus?.status === "skipped" && scan.overviewStatus.reason === "no-model-route";
}

async function scanOnce(root: string, ports: WorkspaceScanPorts, force: boolean): Promise<void> {
  // Hand the folder to Builderforce Desktop so its index starts now: the local index needs no account.
  ports.registerWorkspace(root);
  // The definition-index refresh is UNGATED: no model, no account, no key.
  void ports.refreshSymbolIndex(root).catch((e) => ports.error("BuilderForce symbol index refresh failed:", e));
  // The route reads the inference mode, which is only real once the policy resolved.
  await ports.policyResolved();
  const key = await ports.key();
  const route = await ports.resolveRoute();
  const noModel = ports.noModelReason(route);
  const usable = !noModel && (!!key || !ports.routeRequiresSignIn(route));
  if (!usable && force && noModel) ports.promptNoModel(noModel);

  const work = async () => {
    try {
      let scan = await ports.scan(root, usable ? route : null, force);
      // A cache hit that skipped the overview for want of a route is stale once a route is usable: redo it once.
      if (usable && !force && skippedForNoRoute(scan)) scan = await ports.scan(root, route, true);
      ports.setGrounding(scan.grounding);
      // The digest goes to the project's facts in the background, only when the `sync` capability is granted.
      if (key && ports.syncAllowed()) void ports.afterScan(root, scan).catch((e) => ports.error("BuilderForce workspace digest failed:", e));
    } catch (e) {
      ports.error("BuilderForce codebase scan failed:", e);
    }
  };

  if (force) {
    await ports.withProgress("BuilderForce: rescanning codebase", work);
    ports.info("BuilderForce: codebase knowledge refreshed.");
  } else {
    await work();
  }
}
