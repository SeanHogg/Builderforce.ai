/**
 * The `container` RunTarget (PRD 31 §W1) — the app runs in the project's cloud-run
 * container and is reached through the signed preview ingress. This wraps the ONE
 * existing path (`loadLivePreview` → `GET /runtime/{executions|projects}/:id/preview-url`)
 * behind the port with no change in behaviour:
 * - the container's own run owns its lifecycle, so `stop()` only lets go of the link;
 * - `restart()` mints a new ticket (what Restart has always done);
 * - no container is live → it declines (`noContainerPreview`), never a fake preview;
 * - a plan-limit 402 still rejects, so the surface renders its upgrade gate (D7: the
 *   container tier keeps its `livePreview` entitlement).
 * The container exposes no log channel to the browser yet, so `logs()` is empty.
 */
import { loadLivePreview, type LivePreviewLink } from '@/lib/siteApi';
import { closedLogStream, type RunContext, type RunService, type RunSession, type RunStart, type RunTarget } from './runTarget';

/** A container preview's services: the link's named ones, or its one app. */
export function containerServices(link: LivePreviewLink | null): RunService[] {
  if (!link) return [];
  const state = link.status === 'starting' ? 'starting' : 'live';
  if (link.services && link.services.length > 0) {
    return link.services.map((service) => ({ id: service.id, label: service.label, url: service.url, state, previewable: true }));
  }
  return [{ id: 'app', url: link.url, state, previewable: true }];
}

function containerSession(first: LivePreviewLink, context: RunContext): RunSession {
  let link: LivePreviewLink | null = first;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  return {
    targetId: 'container',
    services: () => containerServices(link),
    url: (serviceId) => containerServices(link).find((service) => service.id === serviceId)?.url,
    logs: () => closedLogStream(),
    async restart() {
      link = await loadLivePreview({ projectId: context.projectId, executionId: context.executionId });
      notify();
    },
    async stop() {
      listeners.clear();
    },
    onState(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

export const containerRunTarget: RunTarget = {
  id: 'container',
  // The container run is already going (W1 starts it); opening the preview only attaches.
  startsOn: 'attach',
  // Anything the browser declines runs here: wrangler/Miniflare, Docker, native addons.
  accepts: () => ({ ok: true }),
  async start(_blueprint, context): Promise<RunStart> {
    const link = await loadLivePreview({ projectId: context.projectId, executionId: context.executionId });
    if (!link) return { ok: false, code: 'noContainerPreview' };
    return { ok: true, session: containerSession(link, context) };
  },
};
