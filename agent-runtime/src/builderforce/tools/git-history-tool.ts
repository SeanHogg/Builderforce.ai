/**
 * Tool for analyzing git history and changes
 */

import { execSync } from "node:child_process";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { jsonResult } from "../../agents/tools/common.js";
import type { GitHistoryEntry } from "../types.js";

const GitHistorySchema = Type.Object({
  projectRoot: Type.String({
    description: "Root directory of the git repository",
  }),
  path: Type.Optional(
    Type.String({
      description: "Specific file or directory to analyze. If omitted, analyzes entire repo.",
    }),
  ),
  limit: Type.Optional(
    Type.Number({
      description: "Maximum number of commits to return. Defaults to 50.",
    }),
  ),
  author: Type.Optional(
    Type.String({
      description: "Filter commits by author email or name",
    }),
  ),
});

type GitHistoryParams = {
  projectRoot: string;
  path?: string;
  limit?: number;
  author?: string;
};

export const gitHistoryTool: AgentTool<typeof GitHistorySchema, string> = {
  name: "git_history",
  label: "Git History",
  description:
    "Analyze git history for a file or directory. Shows commits, authors, and change patterns.",
  parameters: GitHistorySchema,
  async execute(_toolCallId: string, params: GitHistoryParams) {
    const { projectRoot, path: targetPath, limit = 50, author } = params;

    try {
      // Build git log command
      let cmd = `git -C "${projectRoot}" log --format=%H%x00%an%x00%ae%x00%at%x00%s --name-only -n ${limit}`;

      if (author) {
        cmd += ` --author="${author}"`;
      }

      if (targetPath) {
        cmd += ` -- "${targetPath}"`;
      }

      const output = execSync(cmd, { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 });

      const commits: GitHistoryEntry[] = [];
      const blocks = output.split("\n\n").filter((b) => b.trim());

      for (const block of blocks) {
        const lines = block.split("\n");
        if (lines.length < 1) {
          continue;
        }

        const [hash, authorName, authorEmail, timestamp, message] = lines[0].split("\x00");
        const filesChanged = lines.slice(1).filter((f) => f.trim());

        commits.push({
          sha: hash,
          author: `${authorName} <${authorEmail}>`,
          date: new Date(Number.parseInt(timestamp) * 1000),
          message,
          filesChanged,
        });
      }

      // Calculate statistics
      const authors = new Set(commits.map((c) => c.author));
      const files = new Set(commits.flatMap((c) => c.filesChanged));

      return jsonResult({
        totalCommits: commits.length,
        uniqueAuthors: authors.size,
        uniqueFiles: files.size,
        commits: commits.slice(0, 20).map((c) => ({
          sha: c.sha.slice(0, 8),
          author: c.author,
          date: c.date.toISOString(),
          message: c.message,
          filesChanged: c.filesChanged.length,
        })),
        topAuthors: Array.from(authors)
          .map((author) => ({
            author,
            commits: commits.filter((c) => c.author === author).length,
          }))
          .toSorted((a, b) => b.commits - a.commits)
          .slice(0, 10),
        topFiles: Array.from(files)
          .map((file) => ({
            file,
            commits: commits.filter((c) => c.filesChanged.includes(file)).length,
          }))
          .toSorted((a, b) => b.commits - a.commits)
          .slice(0, 10),
      }) as AgentToolResult<string>;
    } catch (error) {
      return jsonResult({
        error: `Failed to analyze git history: ${error instanceof Error ? error.message : String(error)}`,
      }) as AgentToolResult<string>;
    }
  },
};
