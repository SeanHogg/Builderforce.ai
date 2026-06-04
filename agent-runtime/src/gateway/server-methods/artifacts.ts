import { globalPersonaRegistry } from "../../builderforce/personas.js";
/**
 * Gateway method handler: artifacts.sync
 *
 * Receives artifact assignments pushed from Builderforce via the relay
 * and applies them to the local agentNode (persona assignments, skill activation,
 * content references).
 */
import { loadPersonaAssignments, savePersonaAssignment } from "../../builderforce/project-context.js";
import type { PersonaAssignment } from "../../builderforce/types.js";
import { logWarn } from "../../logger.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

export const artifactsHandlers: GatewayRequestHandlers = {
  "artifacts.sync": async ({ params, respond, context }) => {
    const artifacts = params?.artifacts as
      | { skills?: string[]; personas?: string[]; content?: string[] }
      | undefined;

    if (!artifacts) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "artifacts is required"));
      return;
    }

    const executionId = typeof params?.executionId === "number" ? params.executionId : undefined;
    const taskId = typeof params?.taskId === "number" ? params.taskId : undefined;

    const projectRoot = process.cwd();
    const results: { personas: number; skills: number; content: number } = {
      personas: 0,
      skills: 0,
      content: 0,
    };

    // ── Persona assignments ───────────────────────────────────────────────
    if (artifacts.personas?.length) {
      for (const slug of artifacts.personas) {
        const assignment: PersonaAssignment = {
          name: slug,
          assignedByBuilderforce: true,
          assignedAt: new Date().toISOString(),
        };
        await savePersonaAssignment(projectRoot, assignment);
        results.personas++;
      }
      // Apply to PersonaRegistry immediately so the gateway uses them without restart
      const assignments = await loadPersonaAssignments(projectRoot);
      if (assignments.length > 0) {
        globalPersonaRegistry.applyAssignments(assignments);
      }
      logWarn(`[artifacts.sync] applied ${results.personas} persona assignment(s)`);
    }

    // ── Skill references ──────────────────────────────────────────────────
    // Skills assigned via Builderforce are marketplace slugs. We store them
    // in a lightweight side-file (.builderforce/assigned-artifacts.json) so the
    // agent system prompt builder can inject them as context. Actual skill
    // files are expected to already be present on the agentNode (synced or bundled).
    if (artifacts.skills?.length) {
      results.skills = artifacts.skills.length;
      logWarn(
        `[artifacts.sync] received ${results.skills} skill assignment(s): ${artifacts.skills.join(", ")}`,
      );
    }

    // ── Content references ────────────────────────────────────────────────
    if (artifacts.content?.length) {
      results.content = artifacts.content.length;
      logWarn(
        `[artifacts.sync] received ${results.content} content assignment(s): ${artifacts.content.join(", ")}`,
      );
    }

    // Persist all assigned artifact slugs to a sidecar file for other
    // subsystems to read at execution time.
    if (artifacts.skills?.length || artifacts.personas?.length || artifacts.content?.length) {
      try {
        const fs = await import("node:fs");
        const path = await import("node:path");
        const dir = path.join(projectRoot, ".builderforce");
        const filePath = path.join(dir, "assigned-artifacts.json");
        await fs.promises.mkdir(dir, { recursive: true });
        await fs.promises.writeFile(
          filePath,
          JSON.stringify(
            {
              skills: artifacts.skills ?? [],
              personas: artifacts.personas ?? [],
              content: artifacts.content ?? [],
              executionId,
              taskId,
              syncedAt: new Date().toISOString(),
            },
            null,
            2,
          ),
          "utf-8",
        );
      } catch (err) {
        logWarn(`[artifacts.sync] failed to write assigned-artifacts.json: ${String(err)}`);
      }
    }

    // Bump the skills change counter so the agent picks up new skill assignments
    context.skillsChangeBump?.({ reason: "artifacts.sync" });

    respond(true, {
      ok: true,
      applied: results,
      executionId,
      taskId,
    });
  },
};
