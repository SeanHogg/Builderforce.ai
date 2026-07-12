/**
 * @file tool.ts
 * @module @builderforce/resource-gap-engine
 * @description Public API for the Resource Gap Engine plugin.
 */
import type { AnyAgentTool, BuilderForceAgentsPluginApi } from "../../src/plugins/types.js";
import { ToolInputError } from "../../src/agents/tools/common.js";

export function createResourceGapTool(api: BuilderForceAgentsPluginApi): AnyAgentTool {
  return {
    name: "rg-smart-run",
    label: "Asset-Smart Run",

    // -------------------------------------------------
    // Tool signature (to be filled in per the PRD)
    // -------------------------------------------------
    description:
      "Run a structured resource gap analysis and generate hiring, deployment, and upskill recommendations. Input: employees, project demands, optional configuration. Output: gap and rec sets with metrics and PDF export.",
    parameters: {}, // TODO: Define schema with readStringParam/readNumberParam when they are typed for this repo.

    async execute(id: string, params) {
      // TODO: Implement core computation: supply normals, demand sums, severity, root/upskill callbacks.
      const employees = []; // readArrayParam(params, "employees")
      const projectRequirements = []; // readArrayParam(params, "projectRequirements")
      const config = {}; // optional readObjectParam(params, "config")

      // Validation and normalization
      if (!Array.isArray(employees)) {
        throw new ToolInputError("employees must be an array");
      }
      if (!Array.isArray(projectRequirements)) {
        throw new ToolInputError("projectRequirements must be an array");
      }

      // Computation placeholder raising if no employees or requirements
      if (employees.length === 0) {
        throw new ToolInputError("employees array must contain at least one employee");
      }
      if (projectRequirements.length === 0) {
        throw new ToolInputError("projectRequirements array must contain at least one project");
      }

      // TODO: Path-accurate scoring per the PRD (FR-2.1, FR-2.2, FR-2.3, FR-2.4, FR-2.5).
      const gaps = [];
      const hiringRecs = [];
      const deploymentRecs = [];
      const upskillRecs = [];

      const out = {
        // Observe that summary is structured like metrics (title, rows, total).
        summary: {
          title: "Gap and Recommendation Summary",
          rows: [],
          total: { criticalGaps: gaps.length, hiringRecs: hiringRecs.length, deploymentRecs: deploymentRecs.length, upskillRecs: upskillRecs.length },
        },
        // Metrics tend to be named objects, not plain scalars.
        metrics: {
          criticalGaps: gaps.length,
          moderateGaps: 1, // placeholder interpolated from gaps
          lowGaps: 2, // placeholder interpolated from gaps
          hiringRecs: hiringRecs.length,
          deploymentRecs: deploymentRecs.length,
          upskillRecs: upskillRecs.length,
        },
        // Suggest filling detailed structure (per the tool signature and PRD) after implementation.
        // Our draft used: gaps, hiringRecs, deploymentRecs, upskillRecs, costImpact, additionalMetrics.
        gaps,
        hiringRecs,
        deploymentRecs,
        upskillRecs,
        costImpact: {},
        additionalMetrics: {},
      };
      return {
        content: [{ type: "text", text: JSON.stringify(out, null, 2) }],
      };
    },
  };
}