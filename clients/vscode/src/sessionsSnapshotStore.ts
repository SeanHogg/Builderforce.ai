import * as vscode from "vscode";
import { BfBrainChat, BfCreationSessionSummary, listAgentPool, listBrainChats, listCreationSessions } from "./bfApi";
import { SECRET_KEY } from "./gateway";
import { getSelectedProject } from "./projectState";
import { getProjectNames } from "./projectNames";
import { createRefreshCoalescer } from "./refreshCoalescer";

/** What the server said about the account's sessions and chats, as of `ts`. */
export type SessionsSnapshot = {
  ts: number;
  sessions: BfCreationSessionSummary[];
  chats: BfBrainChat[];
  /** Project id → name, for labelling chats when the list is not project-scoped. */
  projectNameById: ReadonlyMap<number, string>;
  /** Participant ref → display name, from the (stable) tenant agent pool. */
  agentNames: ReadonlyMap<string, string>;
};
type Fetched = Omit<SessionsSnapshot, "ts">;

/**
 * The Sessions list's data: ONE snapshot of what the server holds, fetched once and
 * read by every group, with stale-while-revalidate semantics.
 *
 * The snapshot is never dropped to force a refetch. A refresh fetches FIRST and swaps
 * the snapshot in only when the answer arrives, so the painted list never blanks; a
 * burst of refreshes (one per platform write while an agent run creates tickets)
 * collapses to one request; and an answer identical to what is held changes nothing,
 * so {@link onDidChange} — the tree's cue to repaint — fires only when the list moved.
 */
export class SessionsSnapshotStore implements vscode.Disposable {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  /** The snapshot's content changed (including being dropped on sign-out). */
  readonly onDidChange = this._onDidChange.event;

  private snapshot: SessionsSnapshot | undefined;
  /** Signature of the snapshot held — an identical refetch fires nothing. */
  private sig = "";
  /** The request in flight, shared so concurrent first paints make ONE set of calls. */
  private inflight: Promise<Fetched> | undefined;
  /** Bumped per reload so a slow, older response never overwrites a newer one. */
  private reloadSeq = 0;
  /** Older than this when read → revalidate in the background. */
  private static readonly STALE_MS = 30_000;
  /** Refresh bursts collapse to one refetch per window. */
  private static readonly RELOAD_WINDOW_MS = 2_000;
  private readonly reload = createRefreshCoalescer(() => this.reloadNow(), SessionsSnapshotStore.RELOAD_WINDOW_MS);

  // Carried across fetches: names resolve best-effort, so a failed lookup keeps the last.
  private projectNameById: ReadonlyMap<number, string> = new Map();
  private agentNames: ReadonlyMap<string, string> = new Map();

  constructor(private readonly secrets: vscode.SecretStorage) {}

  /** The snapshot held right now, without fetching. */
  get current(): SessionsSnapshot | undefined {
    return this.snapshot;
  }

  /**
   * The snapshot to paint from. Held, it is returned at once (and revalidated in the
   * background once stale); only the very first read waits on the network.
   *
   * A failed first fetch rejects — there is no last good list to fall back on. After
   * that a failure never reaches a reader: a reload keeps the old snapshot, because a
   * rejected `getChildren` drops the children in the extension host while the rows stay
   * painted, so the next click would land on a row the host no longer knows about.
   */
  async get(): Promise<SessionsSnapshot> {
    if (this.snapshot) {
      if (Date.now() - this.snapshot.ts > SessionsSnapshotStore.STALE_MS) this.refresh();
      return this.snapshot;
    }
    const fetched = await this.fetchShared();
    if (!this.snapshot) this.adopt(fetched);
    return this.snapshot!;
  }

  /** Revalidate (after create / rename / delete / invite / sign-in, or any signal the
   *  server's list moved). Throttled; fires {@link onDidChange} only if it moved. */
  refresh(): void {
    this.reload.request();
  }

  dispose(): void {
    this.reload.dispose();
    this._onDidChange.dispose();
  }

  private async reloadNow(): Promise<void> {
    const seq = ++this.reloadSeq;
    if (!(await this.secrets.get(SECRET_KEY))) {
      // Signed out: forget the account's list, once.
      if (this.snapshot) {
        this.snapshot = undefined;
        this.sig = "";
        this._onDidChange.fire();
      }
      return;
    }
    let fetched: Fetched;
    try {
      fetched = await this.fetchShared();
    } catch {
      // Offline, or the gateway blinked: keep the last good list.
      return;
    }
    if (seq !== this.reloadSeq) return;
    if (this.adopt(fetched)) this._onDidChange.fire();
  }

  /** Take a fetched list as the snapshot; returns whether it says something new. */
  private adopt(fetched: Fetched): boolean {
    this.snapshot = { ts: Date.now(), ...fetched };
    const sig = JSON.stringify([fetched.sessions, fetched.chats, [...fetched.projectNameById], [...fetched.agentNames]]);
    if (sig === this.sig) return false;
    this.sig = sig;
    return true;
  }

  /** One fetch at a time: the groups' first paint and a reload share it. */
  private fetchShared(): Promise<Fetched> {
    this.inflight ??= this.fetchList().finally(() => { this.inflight = undefined; });
    return this.inflight;
  }

  /**
   * The whole list, fetched once and shared by every group.
   *
   * Fetched ONCE on purpose: the groups are readings of one list, so fetching per group
   * would be the same requests several times over — and worse, lists that could
   * disagree about what is newest if a write landed between them.
   */
  private async fetchList(): Promise<Fetched> {
    const [sessions, chats] = await Promise.all([
      listCreationSessions(this.secrets),
      listBrainChats(this.secrets),
    ]);

    // Resolve participant names — a single stable pool fetch, not a per-row call, so the
    // roster costs no N+1, and only when some participant has no name yet (humans carry
    // theirs inline). Best-effort: a row with a raw participant ref still opens, a list
    // that failed to draw does not.
    const nameless = chats.some((c) => (c.participants ?? []).some((p) => !(p as { name?: string }).name && !this.agentNames.has(p.ref)));
    if (nameless) {
      try {
        const pool = await listAgentPool(this.secrets);
        this.agentNames = new Map(pool.map((a) => [a.ref, a.name]));
      } catch {
        // Keep the names already resolved.
      }
    }

    // Unfiltered: resolve project names for the per-row labels (best-effort, cached).
    if (!getSelectedProject()) {
      try {
        this.projectNameById = await getProjectNames(this.secrets);
      } catch {
        // Keep whatever names we already resolved; the row falls back to the time alone.
      }
    }
    return { sessions, chats, projectNameById: this.projectNameById, agentNames: this.agentNames };
  }
}
