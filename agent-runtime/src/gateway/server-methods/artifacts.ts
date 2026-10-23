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
import { writeAssignedArtifactSlugs } from "../../agents/assigned-artifacts-sidecar.js";
import { syncAssignedSkills } from "../../agents/skills/assigned-sync.js";
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
    // The run's working directory (its ticket workspace), sent by the relay. Older relays
    // omit it; the gateway's own root is then the run's workspace, as it always was.
    const workspaceDir =
      typeof params?.workspaceDir === "string" && params.workspaceDir.trim() ? params.workspaceDir : undefined;

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

    // ── Run sidecar ───────────────────────────────────────────────────────
    // This run's assignment, keyed by the run's own workspace so concurrent runs on the
    // host never overwrite each other's list. Written FIRST (and for an empty assignment
    // too): the skill sync below counts every live run's sidecar, and the loader reads
    // this run's to decide which synced skills it sees.
    const runSkills = (artifacts.skills ?? []).map((s) => s.trim()).filter(Boolean);
    try {
      await writeAssignedArtifactSlugs(workspaceDir, {
        skills: runSkills,
        personas: artifacts.personas ?? [],
        content: artifacts.content ?? [],
        executionId,
        taskId,
      });
    } catch (err) {
      logWarn(`[artifacts.sync] failed to write the run's assigned-artifacts sidecar: ${String(err)}`);
    }

    // ── Skills ────────────────────────────────────────────────────────────
    // The managed skills dir mirrors every skill this HOST may need: the gateway's host
    // listing plus every live run's own assignment (task-scoped skills reach a run but
    // not the host listing). New or changed ones are fetched as real Agent Skills
    // folders; ones no listing and no live run claims are removed. Which of them THIS
    // run loads is decided at load time from its own sidecar (see
    // `filterSyncedSkillsForRun` in assigned-sync.ts).
    if (Array.isArray(artifacts.skills)) {
      const synced = await syncAssignedSkills({ runSkills });
      results.skills = synced.written.length + synced.unchanged.length;
      logWarn(
        `[artifacts.sync] skills: ${synced.written.length} fetched, ${synced.unchanged.length} unchanged` +
          (synced.written.length ? `: ${synced.written.join(", ")}` : "") +
          (synced.removed.length ? `; removed unassigned ${synced.removed.join(", ")}` : "") +
          (synced.skipped.length
            ? `; skipped ${synced.skipped.map((s) => `${s.slug} (${s.reason})`).join(", ")}`
            : ""),
      );
    }

    // ── Content references ────────────────────────────────────────────────
    if (artifacts.content?.length) {
      results.content = artifacts.content.length;
      logWarn(
        `[artifacts.sync] received ${results.content} content assignment(s): ${artifacts.content.join(", ")}`,
      );
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
