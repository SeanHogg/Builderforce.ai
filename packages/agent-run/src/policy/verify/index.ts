/**
 * policy/verify — the run-end verify: the project's own declared checks run in a shell
 * (the sandbox executor), or the branch's CI, with honest exit codes; and the ordered
 * verify events every surface records.
 *
 * Owned by WS2d. Ports `api/src/application/runtime/cloudAgent/inRunVerify.ts`
 * (`inRunVerify.ts` alongside), `sandbox/sandboxVerify.ts` (`sandboxVerify.ts`) and
 * `cloudAgent/runEndMemory.ts` (`runEndMemory.ts` + `recordVerifyEvents.ts`) behind the
 * `VerifyHook.verify` contract `policy/hooks.ts` names. The DB-backed timeline write and
 * the memory commit stay on the host (the `runEndMemory` port), so a Worker, a browser
 * and Node all verify the same way and record the same pair of events in the same order.
 *
 * No `node:*` imports, no DOM: this file is compiled into the Worker, the browser and
 * Node.
 */

import type { PolicyContext, VerifyHook, VerifyResult } from "../hooks.js";
import { runSandboxVerify, type VerifySandbox, type VerifyShell } from "./sandboxVerify.js";
import { runVerifyPhase } from "./runEndMemory.js";
import { recordVerifyEvents } from "./recordVerifyEvents.js";
import type { InRunVerifyOutcome } from "./inRunVerify.js";

/** The optional engine ports a surface binds with {@link createVerifyHook}. */
export interface VerifyPorts {
  /** The sandbox's clone, when this surface has one (enables the declared-checks verify). */
  sandbox?: VerifySandbox;
  /** The shell the commands run through (heartbeat + cancel), when this surface has one. */
  shell?: VerifyShell;
  /** Record the ordered verify events this verify emitted, on the run's timeline. */
  recordEvents?: (events: { type: "verify_started" } | { tool: string; category: string; detail: Record<string, unknown>; result: string }) => Promise<void> | void;
  /**
   * Which runtime the shell belongs to. The host names it — never inferred from
   * `RunPolicy.entryPoint`. Absent ⇒ `durable` (no shell).
   */
  surface?: "durable" | "sandbox" | "on-prem";
}

/** The ordered pair every surface records: `verify_started`, then the outcome. */
async function record(ports: VerifyPorts, outcome: InRunVerifyOutcome): Promise<void> {
  if (!ports.recordEvents) return;
  const events = recordVerifyEvents(outcome);
  await ports.recordEvents(events.started);
  await ports.recordEvents(events.completed);
}

function writtenPathsOf(ctx: PolicyContext): readonly string[] {
  return ctx.state.writtenPaths ?? [];
}

/**
 * The verify hook for a surface's engine couplings. `RunPolicy.verify` decides WHAT
 * verifies: `none` ⇒ nothing; `declared-checks` ⇒ the project's OWN declared checks run
 * in the shell when the surface has one, and their honest exit codes become the verdict;
 * `branch-ci` (or a shell-less surface) ⇒ the honest skip, and the branch's CI (the
 * finish gate's `pollBranchCi` port) remains the source of truth. Never fakes a check a
 * surface could not run. An adapter binds its ports with
 * `composePolicyHooks({ verify: createVerifyHook(ports) })`.
 */
export function createVerifyHook(ports: VerifyPorts = {}): VerifyHook {
  return {
    async verify(ctx: PolicyContext): Promise<VerifyResult | void> {
      if (ctx.policy.verify === "none") return undefined;
      const writtenPaths = writtenPathsOf(ctx);
      // Nothing written ⇒ nothing to verify. The finish gate owns the no-deliverable decision.
      if (writtenPaths.length === 0) return undefined;

      const surface = ports.surface ?? "durable";
      if (ctx.policy.verify === "declared-checks" && ports.sandbox && ports.shell && surface !== "durable") {
        const ran = await runSandboxVerify(ports.sandbox, ports.shell);
        const outcome = runVerifyPhase({
          surface: surface === "on-prem" ? "on-prem" : "sandbox",
          writtenPaths,
          packageScripts: ran.packageScripts,
          runner: ran.runner,
          results: ran.results,
        });
        await record(ports, outcome);
        return { ok: outcome.mayFinish, note: outcome.note };
      }

      // Shell-less (or branch CI): the honest answer, never a claimed pass. The branch's
      // CI gate (the finish hook's `pollBranchCi` port) is the in-run check here.
      const outcome = runVerifyPhase({ surface: "durable", writtenPaths, results: null });
      await record(ports, outcome);
      return { ok: outcome.mayFinish, note: outcome.note };
    },
  };
}

/** The verify hook with no engine couplings: the honest shell-less verdict. */
export const verifyHook: VerifyHook = createVerifyHook();
