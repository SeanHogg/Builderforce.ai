import type { Command } from "commander";
import { loadProjectContext } from "../../builderforce/project-context-store.js";
import { danger } from "../../globals.js";
import { readSharedEnvVar } from "../../infra/env-file.js";
import { triggerWorkflow } from "../../infra/workflow-trigger.js";
import { defaultRuntime } from "../../runtime.js";
import { formatDocsLink } from "../../terminal/links.js";
import { theme } from "../../terminal/theme.js";

/**
 * Resolve the Builderforce connection (baseUrl + apiKey + agentNodeId) for a CLI
 * trigger. agentNodeId comes from the env override first, then the project
 * context (`.builderforce/context.yaml`). Returns null with a message when the
 * connection is not configured.
 */
async function resolveConnection(): Promise<
  { baseUrl: string; apiKey: string; agentNodeId: string } | { error: string }
> {
  const apiKey = readSharedEnvVar("BUILDERFORCE_API_KEY")?.trim();
  if (!apiKey) {
    return {
      error:
        "Not linked to Builderforce (BUILDERFORCE_API_KEY not set in ~/.builderforce/.env). Run `builderforce onboard` first.",
    };
  }
  const baseUrl = readSharedEnvVar("BUILDERFORCE_URL")?.trim() || "https://api.builderforce.ai";

  let agentNodeId = readSharedEnvVar("BUILDERFORCE_AGENT_NODE_ID")?.trim();
  if (!agentNodeId) {
    const ctx = await loadProjectContext(process.cwd()).catch(() => null);
    agentNodeId = ctx?.builderforce?.instanceId?.trim();
  }
  if (!agentNodeId) {
    return {
      error:
        "No agentHost id found (BUILDERFORCE_AGENT_NODE_ID unset and no builderforce.instanceId in .builderforce/context.yaml). Run `builderforce init`.",
    };
  }
  return { baseUrl, apiKey, agentNodeId };
}

/** Parse `--input key=value` (repeatable) into a plain object. */
function parseInputs(raw: unknown): Record<string, unknown> {
  const list = Array.isArray(raw) ? raw : raw != null ? [raw] : [];
  const inputs: Record<string, unknown> = {};
  for (const entry of list) {
    const str = String(entry);
    const eq = str.indexOf("=");
    if (eq <= 0) {
      throw new Error(`Invalid --input "${str}"; expected key=value`);
    }
    inputs[str.slice(0, eq).trim()] = str.slice(eq + 1);
  }
  return inputs;
}

export function registerWorkflowCli(program: Command) {
  const workflow = program
    .command("workflow")
    .description("Trigger and manage Builderforce workflows from the CLI / CI")
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/workflow", "docs.builderforce.ai/cli/workflow")}\n`,
    );

  workflow
    .command("run")
    .alias("trigger")
    .description("Trigger a workflow or spec run (exits non-zero on failure, for CI gating)")
    .argument("<name>", "Workflow name or id to trigger")
    .option("-d, --description <text>", "Free-text goal/description forwarded to the run")
    .option(
      "-i, --input <key=value>",
      "Structured input (repeatable)",
      (value: string, prev: string[] = []) => [...prev, value],
    )
    .option("--json", "Output the raw JSON result", false)
    .action(async (name: string, opts: Record<string, unknown>) => {
      try {
        const conn = await resolveConnection();
        if ("error" in conn) {
          defaultRuntime.error(danger(conn.error));
          defaultRuntime.exit(1);
          return;
        }

        const inputs = parseInputs(opts.input);
        const result = await triggerWorkflow(conn, {
          workflow: name,
          description: typeof opts.description === "string" ? opts.description : undefined,
          inputs: Object.keys(inputs).length > 0 ? inputs : undefined,
        });

        if (opts.json) {
          defaultRuntime.log(JSON.stringify(result, null, 2));
        } else if (result.ok) {
          defaultRuntime.log(
            `Triggered workflow "${name}"${result.runId ? ` (run ${result.runId})` : ""}.`,
          );
        } else {
          defaultRuntime.error(danger(`Trigger failed: ${result.error ?? "unknown error"}`));
        }

        // Non-zero exit on failure so CI pipelines can gate on the trigger.
        defaultRuntime.exit(result.ok ? 0 : 1);
      } catch (err) {
        defaultRuntime.error(danger(String(err)));
        defaultRuntime.exit(1);
      }
    });
}
