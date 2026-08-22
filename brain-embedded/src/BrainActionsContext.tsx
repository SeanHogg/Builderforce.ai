'use client';

/**
 * MCP-style page-action registry — the client-side extension contract.
 *
 * Any page or component declares the capabilities it exposes to the Brain by
 * calling `useRegisterBrainActions([...])`. Each action becomes an OpenAI tool
 * spec the Brain sends to the model; when the model calls it, the Brain runs the
 * matching `run(args)` handler and feeds the result back into the conversation.
 *
 * Consumers never touch the LLM — they only declare what the Brain can do while
 * they are mounted. The registry is the single seam between the shared Brain
 * and consumer-specific behaviour, so adding a capability never means editing
 * the Brain itself.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { BrainToolSpec } from './streamChatCompletion';
import { toolSpecsFor } from './toolSpecs';

/** A capability a consumer exposes to the Brain (the MCP extension unit). */
export interface BrainAction<A = unknown, R = unknown> {
  /** Globally-unique, flat snake_case (no dots) so it round-trips through the gateway. */
  name: string;
  description: string;
  /** JSON Schema for the action arguments (becomes the tool's `function.parameters`). */
  parameters: Record<string, unknown>;
  /**
   * Whether running this action changes state — drives the host's
   * confirm-before-mutate gate (see `useBrainConversation`'s `confirmTool`).
   * Use a predicate when mutation depends on the args (e.g. a dispatcher tool
   * that proxies both reads and writes). Defaults to read-only (no gate).
   */
  mutates?: boolean | ((args: A) => boolean);
  run(args: A): Promise<R> | R;
}

export interface BrainActionsContextValue {
  /** Tool specs for every currently-registered action (for the model). */
  toolSpecs: BrainToolSpec[];
  /** Execute a registered action by name. Returns a recoverable error object for unknown tools. */
  runTool(name: string, args: unknown): Promise<unknown>;
  /** Whether the named action would mutate state for these args (false if unknown). */
  isMutating(name: string, args: unknown): boolean;
  /** Register a batch of actions; returns an unregister function. (Used by the hook.) */
  register(actions: BrainAction[]): () => void;
}

const BrainActionsContext = createContext<BrainActionsContextValue | null>(null);

/** What a registrant needs, and nothing else. */
type BrainActionRegistrar = (actions: BrainAction[]) => () => void;

/**
 * The REGISTRATION seam, deliberately separate from the read seam above.
 *
 * A registrant subscribed to `BrainActionsContext` re-rendered every time the
 * registry changed — including on its OWN registration, because registering
 * bumps the version and rebuilds the context value. Any registrant whose action
 * array was not referentially stable then rebuilt it, re-registered, bumped
 * again, and the app re-rendered forever: React never reached an idle frame, so
 * every `startTransition` (which is what every `next/link` navigation is) was
 * starved and NO LINK ON THE SITE NAVIGATED. Observed in production 2026-08-22.
 *
 * The value here is the `register` callback itself, which is stable for the
 * provider's lifetime — so subscribing to it can never re-render anybody.
 */
const BrainRegistrarContext = createContext<BrainActionRegistrar | null>(null);

interface Entry {
  action: BrainAction;
  /** Identity token of the registration that owns this name, so an unmounting
   *  owner never deletes an entry a newer registration has since claimed. */
  token: symbol;
}

export function BrainActionsProvider({ children }: { children: React.ReactNode }) {
  const registry = useRef(new Map<string, Entry>());
  // Bump to recompute `toolSpecs` whenever the registry mutates.
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  const register = useCallback((actions: BrainAction[]) => {
    const token = Symbol('brain-action-registration');
    for (const action of actions) {
      // Last writer wins.
      registry.current.set(action.name, { action, token });
    }
    bump();
    return () => {
      for (const action of actions) {
        const cur = registry.current.get(action.name);
        // Only delete if this registration still owns the name.
        if (cur && cur.token === token) registry.current.delete(action.name);
      }
      bump();
    };
  }, [bump]);

  const runTool = useCallback(async (name: string, args: unknown): Promise<unknown> => {
    const entry = registry.current.get(name);
    if (!entry) {
      // Recoverable: hand the model an error result so it can adjust instead of crashing the loop.
      return { error: `Unknown tool: ${name}` };
    }
    try {
      return await entry.action.run(args);
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'Tool execution failed' };
    }
  }, []);

  const isMutating = useCallback((name: string, args: unknown): boolean => {
    const entry = registry.current.get(name);
    if (!entry) return false;
    const m = entry.action.mutates;
    if (typeof m === 'function') {
      // A throwing predicate is treated as "mutating" so we fail safe (gate it).
      try { return !!(m as (a: unknown) => boolean)(args); } catch { return true; }
    }
    return !!m;
  }, []);

  const toolSpecs = useMemo<BrainToolSpec[]>(() => {
    return toolSpecsFor([...registry.current.values()].map((e) => e.action));
    // `version` is the intentional recompute trigger; the ref itself is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  const value = useMemo<BrainActionsContextValue>(
    () => ({ toolSpecs, runTool, isMutating, register }),
    [toolSpecs, runTool, isMutating, register],
  );

  return (
    <BrainRegistrarContext.Provider value={register}>
      <BrainActionsContext.Provider value={value}>{children}</BrainActionsContext.Provider>
    </BrainRegistrarContext.Provider>
  );
}

/** Consume the registry (used by the Brain panel/conversation hook). */
export function useBrainActions(): BrainActionsContextValue {
  const ctx = useContext(BrainActionsContext);
  if (!ctx) {
    throw new Error('useBrainActions must be used within a BrainActionsProvider');
  }
  return ctx;
}

/**
 * The DECLARED contract of a batch of actions — everything the model is told,
 * and nothing about the closures that serve it.
 *
 * This is what registration is keyed on. The split is the whole point:
 *
 *  - A handler's identity changes on every render of any caller that builds its
 *    actions inline. That must NOT re-register: it is the churn that froze the
 *    site, and the handler is reached through a ref anyway (see `liveAction`).
 *  - `description` and `parameters` genuinely change with DATA — the widget and
 *    destination bridges compile the ids they know about into an `enum`. That
 *    MUST re-register, or the model keeps being offered last hour's ids.
 *
 * `mutates` is reduced to its shape rather than its value: a predicate is a
 * closure like `run`, so its identity says nothing, but flipping between a
 * predicate and a literal `true` changes the confirm gate and must be seen.
 */
function declarationSignature(actions: BrainAction[]): string {
  try {
    return JSON.stringify(
      actions.map((a) => [a.name, a.description, a.parameters, typeof a.mutates === 'function' ? 'fn' : a.mutates ?? false]),
    );
  } catch {
    // A parameters object that will not serialise (a cycle, a BigInt) is not a
    // reason to stop registering — fall back to the names, which always do.
    return actions.map((a) => a.name).join(',');
  }
}

/**
 * The registry entry for one name, reading through to the caller's LATEST action.
 *
 * Registration is keyed on the declaration above rather than on the array
 * identity, so the object that lands in the registry has to stay correct while
 * the caller's closures are replaced under it. Getters do that: `description`,
 * `parameters` and `mutates` are read at the moment the Brain builds a tool spec
 * or checks the mutation gate, and `run` dispatches to the newest handler —
 * never to the one that happened to be current at registration.
 */
function liveAction(name: string, latest: { current: BrainAction[] }): BrainAction {
  const current = () => latest.current.find((a) => a.name === name);
  return {
    name,
    get description() { return current()?.description ?? ''; },
    get parameters() { return current()?.parameters ?? { type: 'object', properties: {} }; },
    get mutates() { return current()?.mutates; },
    run: (args: unknown) => {
      const action = current();
      // The owner re-rendered this name away between registration and the call.
      if (!action) return { error: `Unknown tool: ${name}` };
      return action.run(args);
    },
  };
}

/**
 * Register page actions for as long as the calling component is mounted.
 *
 * The array does NOT have to be referentially stable. It used to — the contract
 * was a comment asking callers to `useMemo`, and one caller that did not (a
 * `useComponentLabel()` that returned a fresh function every render, feeding
 * `WidgetBrainBridge`'s memo) froze every navigation on the site. A contract a
 * caller can silently break, whose breach takes down the whole app, belongs in
 * the primitive instead: registration is keyed on the action NAMES, and the
 * handlers are read through a ref, so re-running with an equivalent array is
 * free and the registry never churns.
 *
 * If no provider is present (e.g. a route without the Brain) this is a no-op, so
 * pages can call it unconditionally.
 */
export function useRegisterBrainActions(actions: BrainAction[]): void {
  const register = useContext(BrainRegistrarContext);
  const latest = useRef(actions);
  // Declared BEFORE the registration effect so it has already run when that one
  // fires in the same commit — no render-phase ref write, which concurrent
  // rendering does not guarantee.
  useEffect(() => { latest.current = actions; }, [actions]);

  const signature = declarationSignature(actions);
  // The names are carried alongside so the effect never has to parse them back
  // out of the signature — a tool name is flat snake_case, but a description is
  // free text and could contain anything.
  const names = actions.map((a) => a.name).join(',');

  useEffect(() => {
    if (!register || names === '') return;
    return register(names.split(',').map((name) => liveAction(name, latest)));
    // `names` is derivable from `signature` and would only ever re-fire with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [register, signature]);
}
