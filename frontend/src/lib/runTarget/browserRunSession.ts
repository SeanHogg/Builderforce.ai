/**
 * A browser `ApplicationRuntime` seen as a `RunSession` — the adapter half that
 * translates the runtime's lifecycle (discovered → … → running, failed) into the
 * preview surface's four states, and its log entries into `RunLogLine`s.
 *
 * The session can be REVOKED: when another owner takes the page's one runtime (the
 * editor's workspace), the application is disposed and every service reads `stopped`
 * — the surface says so instead of showing a preview that no longer exists.
 */
import type { ApplicationRuntime, ServiceSnapshot, ServiceState } from '@seanhogg/builderforce-webcontainers/app';
import type { RunLogLine, RunService, RunServiceState, RunSession } from './runTarget';

/** The runtime's lifecycle, as the preview surface states it. */
export const SERVICE_STATE: Readonly<Record<ServiceState, RunServiceState>> = {
  discovered: 'starting',
  preparing: 'starting',
  starting: 'starting',
  ready: 'live',
  running: 'live',
  stopping: 'stopped',
  stopped: 'stopped',
  failed: 'failed',
};

export function toRunService(snapshot: ServiceSnapshot): RunService {
  return {
    id: snapshot.id,
    label: snapshot.id,
    state: SERVICE_STATE[snapshot.state],
    // A page a browser can show: an application listening on a port, never the
    // database (its port speaks Postgres) or a one-off step.
    previewable: snapshot.type === 'application' && snapshot.port !== undefined,
    ...(snapshot.url ? { url: snapshot.url } : {}),
    ...(snapshot.error ? { error: snapshot.error.message } : {}),
  };
}

export interface BrowserRunHandle {
  session: RunSession;
  /** Dispose the application because another owner took the runtime; services read `stopped`. */
  revoke(): Promise<void>;
}

export function browserRunSession(app: ApplicationRuntime, onStop: () => void = () => undefined): BrowserRunHandle {
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  let revoked = false;
  const offState = app.onStateChange(notify);
  const offError = app.onError(notify);
  const dispose = async () => {
    offState();
    offError();
    await app.dispose();
  };

  const session: RunSession = {
    targetId: 'browser',
    services: () => app.listServices().map((snapshot) => {
      const service = toRunService(snapshot);
      return revoked ? { id: service.id, label: service.label, previewable: service.previewable, state: 'stopped' } : service;
    }),
    url: (serviceId) => (revoked ? undefined : app.getUrl(serviceId)),
    logs: (serviceId) => app.logs(serviceId).pipeThrough(new TransformStream({
      transform(entry, controller) {
        controller.enqueue({ serviceId: entry.serviceId, text: entry.text, at: entry.at } satisfies RunLogLine);
      },
    })),
    restart: (serviceId) => (revoked ? Promise.resolve() : app.restart(serviceId)),
    async stop() {
      onStop();
      listeners.clear();
      if (!revoked) await dispose();
    },
    onState(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };

  return {
    session,
    async revoke() {
      if (revoked) return;
      revoked = true;
      await dispose();
      notify();
    },
  };
}
