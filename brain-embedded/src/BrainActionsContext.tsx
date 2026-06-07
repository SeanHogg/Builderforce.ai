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
    return [...registry.current.values()].map(({ action }) => ({
      type: 'function' as const,
      function: {
        name: action.name,
        description: action.description,
        parameters: action.parameters,
      },
    }));
    // `version` is the intentional recompute trigger; the ref itself is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  const value = useMemo<BrainActionsContextValue>(
    () => ({ toolSpecs, runTool, isMutating, register }),
    [toolSpecs, runTool, isMutating, register],
  );

  return <BrainActionsContext.Provider value={value}>{children}</BrainActionsContext.Provider>;
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
 * Register page actions for as long as the calling component is mounted.
 * Pass a STABLE array (wrap in `useMemo`) — the effect re-runs when the array
 * identity changes. If no provider is present (e.g. a route without the Brain),
 * this is a no-op so pages can call it unconditionally.
 */
export function useRegisterBrainActions(actions: BrainAction[]): void {
  const ctx = useContext(BrainActionsContext);
  const register = ctx?.register;
  useEffect(() => {
    if (!register) return;
    return register(actions);
  }, [register, actions]);
}
