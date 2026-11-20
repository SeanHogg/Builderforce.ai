/**
 * The manifest fragments parts share, built from data so every part states only what
 * differs (its runtime, command and install line).
 *
 * Installs are modelled the way W9's blueprint mapping runs them
 * (`frontend/src/lib/runTarget/blueprintToApplicationSpec.ts`): one one-off service per
 * root, on the runtime of its own command, ready on a clean exit and never restarted,
 * which the service in that root depends on. A shell line (`npm install && npm start`)
 * would hide the install from readiness, restart it with the server, and stop the
 * runtime judging each command on its own provider.
 */
import type { KitRoot, KitServiceId, ManifestFragment, ManifestService } from '../types';

/** The port every kit backend listens on (its `PORT` default). */
export const KIT_API_PORT = 8000;

/** The port every kit frontend's dev server answers on. */
export const KIT_WEB_PORT = 5173;

/** The id of the one-off install step for a service. */
export const installStepId = (serviceId: KitServiceId): string => `install-${serviceId}`;

function installStep(runtime: string, root: KitRoot, command: string): ManifestService {
  return { runtime, root, command, readiness: { exitZero: true }, restart: 'never' };
}

interface ServiceShape {
  serviceId: KitServiceId;
  root: KitRoot;
  runtime: string;
  command: string;
  /** The install line, on `installRuntime` (default: the service's runtime); none when the command restores itself (`dotnet run`). */
  install?: string;
  installRuntime?: string;
}

function withInstall(shape: ServiceShape, service: ManifestService): ManifestFragment {
  if (!shape.install) return { services: { [shape.serviceId]: service } };
  const id = installStepId(shape.serviceId);
  return {
    services: {
      [id]: installStep(shape.installRuntime ?? shape.runtime, shape.root, shape.install),
      [shape.serviceId]: { ...service, dependsOn: [id, ...(service.dependsOn ?? [])] },
    },
  };
}

/** A browser-only frontend: its dev server on {@link KIT_WEB_PORT}. The kit composer adds `dependsOn` its backend. */
export function frontendFragment(shape: Omit<ServiceShape, 'serviceId' | 'root'>): ManifestFragment {
  const full: ServiceShape = { ...shape, serviceId: 'web', root: '/web' };
  return withInstall(full, { runtime: shape.runtime, root: full.root, command: shape.command, port: KIT_WEB_PORT, role: 'frontend' });
}

/** A backend on {@link KIT_API_PORT}, ready when `GET /health` answers. */
export function backendFragment(shape: Omit<ServiceShape, 'serviceId' | 'root'>): ManifestFragment {
  const full: ServiceShape = { ...shape, serviceId: 'api', root: '/api' };
  return withInstall(full, {
    runtime: shape.runtime, root: full.root, command: shape.command, port: KIT_API_PORT, role: 'backend', readiness: { http: '/health' },
  });
}
