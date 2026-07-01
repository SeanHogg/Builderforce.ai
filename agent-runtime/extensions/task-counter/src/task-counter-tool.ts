import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import Ajv from "ajv";
// Dynamic import resolution as in llm-task-tool.ts
import type { BuilderForceAgentsPluginApi } from "../../../src/plugins/types.js";

// Type definitions
type Task = {
  id: string;
  project: string;
  status: "open" | "closed" | "in_progress";
  effort?: number | string; // Story points or T-shirt size
  labels?: Record<string, string>;
};

type ProjectEffort = {
  project: string;
  taskCount: number;
  totalEffort: number;
  details?: {
    taskIds: string[];
    effortBySize: Record<string, number>;
  };
};

export function createTaskCounterTool(api: BuilderForceAgentsPluginApi) {
  return {
    name: "task-counter",
    label: "Task Counter",
    description: "Counts open tasks per project and estimates remaining effort using story points or T-shirt sizes. Ideal for workload analysis and capacity planning.",
    parameters: Type.Object({
      tasks: Type.Array(
        Type.Object({
          id: Type.String(),
          project: Type.String(),
          status: Type.Union([Type.Literal("open"), Type.Literal("in_progress")]),
          effort: Type.Optional(
            Type.Union([Type.Number(), Type.String()])
          ),
          labels: Type.Optional(
            Type.Record(Type.String(), Type.String())
          )
        })
      ),
      includeDetails: Type.Optional(Type.Boolean())
    }),

    async execute(_id: string, params: Record<string, unknown>) {
      const pluginCfg = (api.pluginConfig ?? {}) as {
        effortMapping?: Record<string, number>;
        defaultUnestimatedEffort?: number;
        manualOverrides?: Array<{ project: string; override: number }>;
        includeDetails?: boolean;
      };

      const tasks = (params.tasks as Task[]) ?? [];
      const includeDetails = 
        typeof params.includeDetails === "boolean"
          ? params.includeDetails
          : pluginCfg.includeDetails ?? false;

      // Process tasks
      const projectEfforts: Record<string, ProjectEffort> = {};
      const unestimatedTasks: Task[] = [];

      for (const task of tasks) {
        if (task.status !== "open" && task.status !== "in_progress") continue;

        const project = task.project || "uncategorized";
        const override = pluginCfg.manualOverrides?.find(
          (o) => o.project === project
        )?.override;

        let effort = override;
        if (effort === undefined) {
          if (task.effort !== undefined) {
            if (typeof task.effort === "number") {
              effort = task.effort;
            } else {
              // Handle T-shirt sizes
              const mapped = pluginCfg.effortMapping?.[task.effort.toUpperCase()];
              if (mapped !== undefined) {
                effort = mapped;
              } else {
                unestimatedTasks.push(task);
                continue;
              }
            }
          } else {
            // Use default unestimated effort
            effort = pluginCfg.defaultUnestimatedEffort ?? 0.5;
          }
        }

        if (!projectEfforts[project]) {
          projectEfforts[project] = {
            project,
            taskCount: 0,
            totalEffort: 0,
            details: includeDetails ? { taskIds: [], effortBySize: {} } : undefined
          };
        }

        const projectEffort = projectEfforts[project];
        projectEffort.taskCount++;
        projectEffort.totalEffort += effort;

        if (includeDetails && projectEffort.details) {
          projectEffort.details.taskIds.push(task.id);
          const size = typeof task.effort === "string" ? task.effort.toUpperCase() : "UNESTIMATED";
          projectEffort.details.effortBySize[size] = 
            (projectEffort.details?.effortBySize[size] || 0) + 1;
        }
      }

      // Prepare response
      const results = Object.values(projectEfforts);
      const totalTasks = results.reduce((sum, r) => sum + r.taskCount, 0);
      const totalEffort = results.reduce((sum, r) => sum + r.totalEffort, 0);

      const response = {
        totalTasks,
        totalEffort,
        projects: results,
        unestimatedTaskCount: unestimatedTasks.length
      };

      // Validate response schema
      const ajv = new Ajv.default({ allErrors: true });
      const schema = Type.Object({
        totalTasks: Type.Number(),
        totalEffort: Type.Number(),
        projects: Type.Array(
          Type.Object({
            project: Type.String(),
            taskCount: Type.Number(),
            totalEffort: Type.Number(),
            details: Type.Optional(
              Type.Object({
                taskIds: Type.Array(Type.String()),
                effortBySize: Type.Record(Type.String(), Type.Number())
              })
            )
          })
        ),
        unestimatedTaskCount: Type.Number()
      });

      const validate = ajv.compile(schema);
      const isValid = validate(response);
      if (!isValid) {
        throw new Error(`Task counter response schema validation failed: ${validate.errors?.map(e => e.message).join(", ")}`);
      }

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        details: { data: response }
      };
    }
  };
}
