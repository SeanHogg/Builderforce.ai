import type * as vscode from "vscode";
import type { StepDurability, StepOutgoingMessage } from "@seanhogg/builderforce-brain-embedded";
import {
  classifyQueue,
  createOnlineSignal,
  createOutbox,
  createSnapshotOutboxStore,
  gateOutboxSend,
  guardSend,
  type Outbox,
  type OutboxOptions,
  type OutboxSendPermission,
  type OutboxStore,
} from "@builderforce/write-outbox";

/**
 * The extension's adapter for the shared write outbox's DURABLE mode — the one place a
 * VS Code write that must survive being offline (or a reload) gets its storage and its
 * connectivity signal.
 *
 * STORAGE: each durable outbox keeps its queue as ONE value in the extension's
 * `workspaceState` Memento (a snapshot store — the queue is small and bounded). Workspace
 * rather than global state because global state is shared by every open window: two
 * windows rewriting the same snapshot would erase each other's queued writes. A write
 * queued offline in a workspace is replayed the next time that workspace is reachable.
 *
 * The Memento — and the credential every durable outbox sends with — are bound once at
 * activation ({@link bindOutboxStorage}); an outbox created at module load simply waits
 * for them before it loads its backlog or sends anything, so a backlog left by the last
 * session replays as soon as the extension is up, before any new write is made.
 *
 * TENANT: entries remember the tenant they were queued in ({@link setOutboxScope}) and are
 * only sent as that tenant — the sender passes it as `asTenant`, and `bfApi` refuses to
 * send with a token for any other tenant. Another tenant's entries wait, parked.
 *
 * CONNECTIVITY: {@link apiConnectivity} is driven by the API client itself — a request
 * that got no answer at all marks the platform unreachable, any answer marks it reachable
 * again — so a queue parked offline replays the moment ANY call gets through, rather than
 * waiting out its backoff.
 *
 * PERMISSION: connectivity is not permission. Every durable send — the outbox batch, a
 * drain riding along with a caller's own request, and the step-row sender — is gated by
 * {@link outboxSendPermission}. The gate is INJECTED ({@link bindOutboxSendPermission})
 * rather than read from a policy module here, so this file owns storage and gating only
 * and the administrative source stays the caller's decision. A permission that flips to
 * denied mid-flush aborts that flush: the rows stay queued, they are not acknowledged, and
 * they are not retried while the ban holds.
 */

const STORAGE_PREFIX = "builderforce.outbox.";

type OutboxHost = Pick<vscode.ExtensionContext, "workspaceState" | "secrets">;

let bindHost: (host: OutboxHost) => void = () => undefined;
const host = new Promise<OutboxHost>((resolve) => {
  bindHost = resolve;
});

/** Bind the storage and credential every durable outbox uses. Call once from activation. */
export function bindOutboxStorage(context: OutboxHost): void {
  bindHost(context);
}

/** The credential a durable outbox sends with — resolves once activation has bound it. */
export async function outboxSecrets(): Promise<vscode.SecretStorage> {
  return (await host).secrets;
}

/** A durable store named `name`, persisted in the bound Memento. */
export function durableOutboxStore<T, K>(name: string): OutboxStore<T, K> {
  const key = `${STORAGE_PREFIX}${name}`;
  return createSnapshotOutboxStore<T, K>({
    read: async () => (await host).workspaceState.get<unknown>(key),
    write: async (value) => {
      await (await host).workspaceState.update(key, value);
    },
  });
}

/** Is the platform API answering? Set by the API client's own requests. */
export const apiConnectivity = createOnlineSignal(true);

/** Await a request, recording whether the API answered at all. */
export async function trackReachability(request: Promise<Response>): Promise<Response> {
  try {
    const res = await request;
    apiConnectivity.set(true);
    return res;
  } catch (error) {
    apiConnectivity.set(false);
    throw error;
  }
}

/**
 * The administrative send gate every durable outbox reads. Nothing is bound at module
 * load — and an UNBOUND gate DENIES. A window whose activation never bound a permission
 * has not been told sends are allowed, so it must not send: fail-open here would make the
 * ban advisory in exactly the window where it has not been installed, and a durable row
 * would leave the machine with no permission ever having granted it. {@link
 * bindOutboxSendPermission} installs the real permission at activation; until it runs
 * (and again whenever it is cleared with `null`) a send is refused by the outbox with its
 * existing `platform_send_disabled` error rather than being let through.
 */
let boundPermission: OutboxSendPermission | null = null;
const permissionListeners = new Set<(allowed: boolean) => void>();
let unsubscribeBound: (() => void) | null = null;

/**
 * The permission every durable outbox is gated by. Deliberately a stable object: outboxes
 * are built at module load, long before activation binds the policy, so each holds this
 * one gate and reads whatever permission is bound at send time. `isAllowed` is FALSE
 * while nothing is bound — the fail-closed default above, not a fail-open one.
 */
export const outboxSendPermission: OutboxSendPermission = {
  isAllowed: () => boundPermission?.isAllowed() ?? false,
  subscribe(listener) {
    permissionListeners.add(listener);
    return () => {
      permissionListeners.delete(listener);
    };
  },
};

/**
 * The permission currently bound, or `null` when none is. The owner of a binding uses it
 * to tell its own binding apart from a later one, so disposing the earlier owner cannot
 * clear a gate the later one installed.
 */
export function boundOutboxSendPermission(): OutboxSendPermission | null {
  return boundPermission;
}

/**
 * Install (or clear, with `null`) the permission every durable outbox is gated by. The
 * outboxes already built pick it up: the gate is read at send time and forwards this
 * permission's transitions, so a revoke aborts the flushes that are in flight.
 */
export function bindOutboxSendPermission(permission: OutboxSendPermission | null): void {
  unsubscribeBound?.();
  unsubscribeBound = null;
  boundPermission = permission;
  if (permission) {
    unsubscribeBound = permission.subscribe((allowed) => {
      for (const listener of [...permissionListeners]) listener(allowed);
    });
  }
  const allowed = outboxSendPermission.isAllowed();
  for (const listener of [...permissionListeners]) listener(allowed);
}

/**
 * The identities durable writes are sent as; `null` = not known / parked.
 *   - `workspace`: the tenant the API client's tenant JWT acts as (the selected workspace)
 *     — every `/api/*` write.
 *   - `key`: the editor key's own tenant — gateway (`/llm/*`) writes, which always act as
 *     the key whatever workspace is selected.
 */
const scopes: Record<OutboxIdentity, string | null> = { workspace: null, key: null };

export type OutboxIdentity = "workspace" | "key";

/** Every durable outbox's flush, so an identity change can replay what was parked for it. */
const replays = new Set<() => Promise<void>>();

const toScope = (tenantId: number | undefined): string | null => (tenantId === undefined ? null : `tenant:${tenantId}`);

/** The tenant id a scope names (`tenant:<id>`), or undefined. */
export function scopeTenantId(scope: string | undefined): number | undefined {
  const m = scope ? /^tenant:(\d+)$/.exec(scope) : null;
  return m ? Number(m[1]) : undefined;
}

/**
 * The tenants the API client now acts as (`undefined` = not known / signed out / parked).
 * Durable writes are SCOPED to the tenant they were made in: a write queued in workspace A
 * is parked while workspace B is selected — never replayed into B — and sent when A is
 * current again. Called by `bfApi.ts` whenever its effective tenant changes.
 */
export function setOutboxScope(ids: { workspace: number | undefined; key: number | undefined }): void {
  const next = { workspace: toScope(ids.workspace), key: toScope(ids.key) };
  if (next.workspace === scopes.workspace && next.key === scopes.key) return;
  scopes.workspace = next.workspace;
  scopes.key = next.key;
  if (next.workspace !== null || next.key !== null) for (const replay of replays) void replay();
}

/**
 * What a failed send does. Omitted and `"retain-until-acked"` keep the retry policy
 * every existing caller already has. `"drop-on-failure"` does not install that policy,
 * so a best-effort batch is discarded on failure instead of being kept until acknowledged.
 * Durable user-work rows are still retained either way — this option does not weaken them.
 *
 * When the caller omits this, {@link createDurableOutbox} uses `classifyQueue(name)`.
 * A known telemetry name drops. A known user-work name retains. An unknown name is
 * not guessed, so omitting the stamp still retries.
 */
export type DurableOutboxOnFailure = "retain-until-acked" | "drop-on-failure";

/**
 * The ONE way the extension builds a durable outbox: persisted under `name`, scoped to
 * the tenant it was written in (`identity`), retried with backoff unless the caller
 * opts into drop-on-failure, paused while the API is unreachable and replayed when it
 * answers again (or its tenant is current again). A sender should pass
 * `scopeTenantId(ctx.scope)` as the tenant it must act as.
 *
 * Every send is gated by {@link outboxSendPermission}, and the gate is applied to the
 * SENDER rather than left to the outbox alone: senders do not read the abort signal, so a
 * revoke has to reject the flush itself — otherwise a request that lands after the ban
 * would be acknowledged and the durable row dropped.
 */
export function createDurableOutbox<T, K = string>(
  name: string,
  opts: Omit<OutboxOptions<T, K>, "store" | "online" | "retry" | "scope" | "sendPermission"> & {
    onFailure?: DurableOutboxOnFailure;
  },
  identity: OutboxIdentity = "workspace",
): Outbox<T, K> {
  const { onFailure: callerOnFailure, ...rest } = opts;
  const classified = classifyQueue(name);
  // Caller stamps win. A known name fills a missing stamp. An unknown name
  // (activity, run-outcomes, host-persist) is not guessed.
  const onFailure = callerOnFailure ?? classified?.onFailure;
  const work = rest.work ?? (classified ? name : undefined);
  const outbox = createOutbox<T, K>({
    ...rest,
    ...(work !== undefined ? { work } : {}),
    // Omitted keeps retry-until-ack. drop-on-failure omits retry so settleFailure
    // discards a best-effort batch instead of retaining it.
    ...(onFailure === "drop-on-failure" ? {} : { retry: {} }),
    store: durableOutboxStore<T, K>(name),
    online: apiConnectivity,
    sendPermission: outboxSendPermission,
    scope: () => scopes[identity],
    // Senders do not read the abort signal. Reject the flush on revoke so the row
    // stays queued instead of being acknowledged when the request later resolves.
    send: gateOutboxSend(outboxSendPermission, rest.send),
  });
  const gated: Outbox<T, K> = {
    ...outbox,
    drainWith: (key, request) =>
      outbox.drainWith(key, (items, ctx) =>
        guardSend(outboxSendPermission, () => request(items, ctx), ctx.signal),
      ),
  };
  replays.add(() => gated.flush());
  return gated;
}

/** The persistence keys of the stored step queues (`steps:<key>`), by queue key. */
const STEP_PREFIX = "steps:";

/**
 * Brain run step rows, durable the same way: one queue per chat in the workspace state,
 * scoped to the tenant. Installed at activation (`installStepDurability`), which drains
 * every stored queue through `sendRows` right away — no run in the chat is needed.
 *
 * NO platform send permission and no API-reachability pause: in the editor `sendRows`
 * writes the HOST'S LOCAL store (`localBrainApplication().persistence.sendMessages`),
 * which is not a platform send — account sync is the sync transport's own job, gated by
 * `synchronize` there. Holding this queue on the platform send gate refused a signed-in
 * Hybrid run's own closing write (`agent.run failed: platform_send_disabled`) whenever
 * sync was off, and the web and Rovr install their step durability with no such gate.
 */
export function durableStepHost(
  sendRows: (chatId: number, rows: StepOutgoingMessage[], asTenant: number | undefined) => Promise<unknown>,
): StepDurability {
  return {
    storeFor: (key) => durableOutboxStore(`${STEP_PREFIX}${key}`),
    storedKeys: async () => {
      const state = (await host).workspaceState;
      const prefix = `${STORAGE_PREFIX}${STEP_PREFIX}`;
      return state.keys()
        .filter((k) => k.startsWith(prefix))
        .filter((k) => {
          const v = state.get<unknown>(k);
          return Array.isArray(v) && v.length > 0;
        })
        .map((k) => k.slice(prefix.length));
    },
    sendRows: (chatId, rows, scope) => sendRows(chatId, rows, scopeTenantId(scope)),
    scope: () => scopes.workspace,
  };
}
