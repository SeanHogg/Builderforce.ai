import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * useToolConfirmationGate — the ONE human-in-the-loop approval gate for the Brain.
 *
 * ## The subtlety this exists to preserve
 *
 * `needsConfirm` is captured ONCE, at run start, by the tool loop. So the flag it reads
 * must be a REF, not captured state: with plain state the callback the run is holding
 * keeps the value it had when the run began, and a user who ticks "auto-approve" mid-run
 * is prompted for every remaining tool call anyway — the reported "I checked the box and
 * still got three prompts" bug. The ref is the source of truth; the returned
 * `autoApprove` state exists only to drive the toggle's own rendering.
 *
 * That is exactly the kind of non-obvious invariant that does not survive being
 * hand-copied, and it was hand-copied: the web `BrainPanel` and the VS Code webview each
 * had their own ~25-line version. They had already drifted — the predicate's operands
 * were in opposite order, and only one of them persisted the setting — so the same
 * product decision ("does auto-approve stick between sessions?") was answered differently
 * on each surface by accident rather than on purpose.
 *
 * ## What is shared and what is injected
 *
 * The GATE LOGIC is shared: ref-backed liveness, the `mutating && !autoApprove` predicate,
 * and a referentially stable `needsConfirm`. PERSISTENCE is injected, because it is a real
 * per-host decision — a browser has `localStorage` scoped to the user's profile, a VS Code
 * webview's storage is partitioned and may be blocked outright. A host that passes no
 * `persistence` simply starts from `defaultOn` each session, which is a policy, not a
 * missing feature.
 */

/** Reads and writes the persisted auto-approve preference for one host. */
export interface ToolConfirmationPersistence {
  /** Current stored preference, or `undefined` when nothing has been stored. */
  read(): boolean | undefined;
  /** Persist the preference. Must never throw — storage can be blocked. */
  write(on: boolean): void;
}

export interface ToolConfirmationGateOptions {
  /**
   * Does this call mutate anything? Supplied by the host's tool registry — normally
   * `isMutating` from `useBrainActions()`. A throwing predicate must be treated as
   * mutating by its implementation (fail safe), which `BrainActionsContext` already does.
   */
  isMutating: (name: string, args: unknown) => boolean;
  /** Where to persist the preference. Omit for a session-only gate. */
  persistence?: ToolConfirmationPersistence;
  /** Value used when nothing is persisted yet. Defaults to `false` (always confirm). */
  defaultOn?: boolean;
}

export interface ToolConfirmationGate {
  /** Whether auto-approve is on — for rendering the toggle ONLY, never for the gate. */
  autoApprove: boolean;
  /** Flip auto-approve. Takes effect immediately, including for a run already in flight. */
  setAutoApprove: (on: boolean) => void;
  /**
   * The predicate handed to `useBrainConversation({ needsConfirm })`. Referentially
   * stable across auto-approve changes — deliberately, so toggling it does not tear down
   * and restart the conversation.
   */
  needsConfirm: (req: { name: string; args: unknown }) => boolean;
}

export function useToolConfirmationGate(options: ToolConfirmationGateOptions): ToolConfirmationGate {
  const { isMutating, persistence, defaultOn = false } = options;

  const [autoApprove, setAutoApproveState] = useState(defaultOn);
  const autoApproveRef = useRef(defaultOn);

  // Read persisted state after mount, never during render: on the web this runs in a
  // server-rendered tree, and touching storage during render would both throw there and
  // produce a hydration mismatch.
  const persistenceRef = useRef(persistence);
  persistenceRef.current = persistence;
  useEffect(() => {
    const stored = persistenceRef.current?.read();
    const initial = stored ?? defaultOn;
    autoApproveRef.current = initial;
    setAutoApproveState(initial);
  }, [defaultOn]);

  const setAutoApprove = useCallback((on: boolean) => {
    // Ref FIRST: an in-flight run's captured `needsConfirm` reads through it, so the very
    // next tool call in that run already honours the new setting.
    autoApproveRef.current = on;
    setAutoApproveState(on);
    persistenceRef.current?.write(on);
  }, []);

  const needsConfirm = useCallback(
    (req: { name: string; args: unknown }) => isMutating(req.name, req.args) && !autoApproveRef.current,
    [isMutating],
  );

  return { autoApprove, setAutoApprove, needsConfirm };
}

/**
 * A `localStorage`-backed {@link ToolConfirmationPersistence}, guarded so a blocked or
 * partitioned store degrades to "not persisted" instead of throwing during render.
 * `'1'`/`'0'` rather than JSON so an existing stored value keeps its meaning.
 */
export function localStorageConfirmationPersistence(key: string): ToolConfirmationPersistence {
  return {
    read() {
      try {
        const raw = localStorage.getItem(key);
        return raw === null ? undefined : raw !== '0';
      } catch {
        return undefined;
      }
    },
    write(on) {
      try {
        localStorage.setItem(key, on ? '1' : '0');
      } catch {
        /* storage blocked — the session-only value still applies */
      }
    },
  };
}
