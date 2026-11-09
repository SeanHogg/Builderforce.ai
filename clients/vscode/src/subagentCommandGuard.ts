/**
 * The owner's `run_command`, guarded against its own live children (chat #60338).
 *
 * While a child is live, an owner command the child was briefed to run — or has already
 * started — is REFUSED with "<handle> is already running this — call wait_agents for its
 * result" instead of running a second time. The rule is `duplicateOfLiveChild`
 * (`@builderforce/agent-tools`), read through the owner's controls
 * (`ChildControls.runningCommand`); this file only applies it at the dispatch seam, so
 * the shell tool itself (`localShell*.ts`) stays unaware of delegation.
 *
 * Applied where the run's catalog is assembled (`brainToolCatalog.ts`), over every tool:
 * only `run_command` is wrapped, every other def passes through untouched.
 */

import { RUN_COMMAND_TOOL } from "@builderforce/agent-tools";
import type { ToolDef } from "./fileTools";
import type { ChildControls } from "./childRunSpawner";

/** `defs` with `run_command` refusing a command a live child of `children`' owner already owns. */
export function withChildCommandGuard(defs: readonly ToolDef[], children: Pick<ChildControls, "runningCommand"> | undefined): ToolDef[] {
  if (!children) return [...defs];
  return defs.map((def) =>
    def.name !== RUN_COMMAND_TOOL
      ? def
      : {
          ...def,
          execute: async (args, root, run) => {
            const command = typeof args.command === "string" ? args.command : "";
            const refusal = command ? children.runningCommand(command) : null;
            return refusal ? JSON.stringify({ ok: false, refused: true, error: refusal }) : def.execute(args, root, run);
          },
        },
  );
}
