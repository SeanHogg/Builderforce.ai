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

/** The optional engine ports a surface may thread through `PolicyContext` extras. */
export interface VerifyPorts {
  /** The sandbox's clone, when this surface has one (enables the declared-checks verify). */
  sandbox?: VerifySandbox;
  /** The shell the commands run through (heartbeat + cancel), when this surface has one. */
  shell?: VerifyShell;
  /** Read a written file's committed content (the shell-free static fallback). */
  read?: (path: string) => Promise<string | null>;
  /** Record the ordered verify events this verify emitted, on the run's timeline. */
  recordEvents?: (events: { type: "verify_started" } | { tool: string; category: string; detail: Record<string, unknown>; result: string }) => Promise<void> | void;
}

function portsOf(ctx: PolicyContext): VerifyPorts {
  return (ctx as { verifyPorts?: VerifyPorts }).verifyPorts ?? {};
}

function writtenPathsOf(ctx: PolicyContext): readonly string[] {
  return ctx.state.writtenPaths ?? [];
}

/**
 * The verify hook the composition calls. With a sandbox + shell the project's OWN
 * declared checks run and their honest exit codes become the verdict; without one the
 * shell-less surface records an honest skip and the branch's CI (the finish gate's
 * `pollBranchCi` port) remains the source of truth. Never fakes a check a surface could
 * not run.
 */
export const verifyHook: VerifyHook = {
  async verify(ctx: PolicyContext): Promise<VerifyResult | void> {
    const ports = portsOf(ctx);
    const writtenPaths = writtenPathsOf(ctx);
    // Nothing written ⇒ nothing to verify. The finish gate owns the no-deliverable decision.
    if (writtenPaths.length === 0) return undefined;

    // A shell surface runs the declared checks over the clone; a shell-less surface
    // records the skip. `surface` arrives through the extras — the host names which
    // runtime it is, never branched on `RunPolicy.entryPoint`.
    const surface = (ctx as { verifySurface?: "durable" | "sandbox" | "on-prem" }).verifySurface ?? "durable";

    if (ports.sandbox && ports.shell && surface !== "durable") {
      const ran = await runSandboxVerify(ports.sandbox, ports.shell);
      const outcome = runVerifyPhase({
        surface: surface === "on-prem" ? "on-prem" : "sandbox",
        writtenPaths,
        packageScripts: ran.packageScripts,
        runner: ran.runner,
        results: ran.results,
      });
      return { ok: outcome.mayFinish, note: outcome.note };
    }

    // Shell-less: the honest answer, never a claimed pass. The branch's CI gate (the
    // finish hook's `pollBranchCi` port) is the in-run build/type-check/test here.
    const outcome = runVerifyPhase({ surface: "durable", writtenPaths, results: null });
    return { ok: outcome.mayFinish, note: outcome.note };
  },
};
