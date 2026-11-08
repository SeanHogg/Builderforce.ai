/**
 * PRD 41 A2: a project selected while signed out is a PENDING binding. The watcher OWNS the link edge:
 * it binds, through the one linked-root replication entry point, the moment the workspace becomes linked
 * (a session exists AND `synchronize` is granted) and unlinks (stops the pumps) the moment it stops being
 * linked. Exactly one `onLink` per unlinked -> linked edge and one `onUnlink` per linked -> unlinked
 * edge; a bind that reports failure does not count as bound, so the next `check()` retries it.
 */

/** What the workspace is linked to: the linked project's id (or `true`); `false`/`undefined` when unlinked. */
export type LinkedTo = number | string | boolean | undefined | null;

export interface PendingBinding {
  /**
   * Re-evaluate; call on every capability change (sign-in, sign-out, a platform-policy change) and every
   * project selection change. Calls made while an evaluation is running coalesce into one re-evaluation.
   */
  check(): Promise<void>;
}

export interface PendingBindingPorts {
  /** What the workspace is linked to right now (falsy when unlinked). A change of project is a new link. */
  linkedTo: () => LinkedTo;
  /** Bind to the link; resolves true when it was applied. False (or a throw) leaves the watcher unbound. */
  onLink: (to: Exclude<LinkedTo, false | undefined | null>) => Promise<boolean> | boolean;
  /** The link was lost: stop everything bound to it. */
  onUnlink: () => Promise<void> | void;
}

export function pendingBinding(ports: PendingBindingPorts): PendingBinding {
  let bound: LinkedTo;
  let running: Promise<void> | undefined;
  let again = false;

  async function step(): Promise<void> {
    const now = ports.linkedTo();
    if (now === false || now === undefined || now === null) {
      if (bound === undefined) return;
      bound = undefined;
      await ports.onUnlink();
      return;
    }
    if (bound === now) return;
    bound = undefined;
    let ok = false;
    try { ok = await ports.onLink(now); } catch { ok = false; }
    if (ok) bound = now;
  }

  return {
    check() {
      if (running) { again = true; return running; }
      running = (async () => {
        do { again = false; await step(); } while (again);
      })().finally(() => { running = undefined; });
      return running;
    },
  };
}
