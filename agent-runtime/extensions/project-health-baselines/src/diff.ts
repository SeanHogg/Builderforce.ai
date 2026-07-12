/**
 * Diff computation service (PRD #294)
 * Paragraph-level side-by-side diff using Levenshtein distance (Longest Common Subsequence)
 */

import { BaselineMetadata, BaselineContent } from "./types.js";

type Paragraph = {
  content: string;
  line: number;
};

type DeltaDiffBlock = {
  type: "added" | "removed" | "unchanged";
  content: string;
  startLine: number;
  endLine: number;
};

type DiffResult = {
  added: DeltaDiffBlock[];
  removed: DeltaDiffBlock[];
  unchanged: DeltaDiffBlock[];
  summary: {
    additions: number;
    deletions: number;
    unchanged: number;
  };
};

/**
 * Split response text into paragraphs (empty lines as boundaries)
 */
function splitToParagraphs(text: string): Paragraph[] {
  return text
    .split(/\n+/)
    .filter((p) => p.trim().length > 0)
    .map((p, i) => ({
      content: p.trim(),
      line: i + 1
    }));
}

/**
 * Compute LCS diff between two arrays of objects
 */
function lcsDiff(par1: any[], par2: any[]): any[] {
  const n = par1.length;
  const m = par2.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    Array(m + 1).fill(0)
  );
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (par1[i - 1] === par2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  const lcs: any[] = [];
  let i = n,
    j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && par1[i - 1] === par2[j - 1]) {
      lcs.unshift(par1[i - 1]);
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      lcs.unshift(par2[j - 1]);
      j--;
    } else {
      lcs.unshift(par1[i - 1]);
      i--;
    }
  }
  return lcs;
}

/**
 * Convert LCS diff into block-level diff with line numbers
 */
function computeBlockDiff(par1: any[], par2: any[]): DeltaDiffBlock[] {
  const lcs = lcsDiff(par1, par2);
  const blocks: DeltaDiffBlock[] = [];

  let i = 0,
    j = 0;
  while (i < par1.length || j < par2.length) {
    if (i < par1.length && j < par2.length && par1[i] === par2[j]) {
      blocks.push({
        type: "unchanged" as const,
        content: (par1[i] as Paragraph).content,
        startLine: (par1[i] as Paragraph).line,
        endLine: (par1[i] as Paragraph).line
      });
      i++;
      j++;
    } else if (j < par2.length && (i === par1.length || i === lcs.length)) {
      blocks.push({
        type: "added" as const,
        content: (par2[j] as Paragraph).content,
        startLine: (par2[j] as Paragraph).line,
        endLine: (par2[j] as Paragraph).line
      });
      j++;
    } else if (i < par1.length) {
      blocks.push({
        type: "removed" as const,
        content: (par1[i] as Paragraph).content,
        startLine: (par1[i] as Paragraph).line,
        endLine: (par1[i] as Paragraph).line
      });
      i++;
    } else {
      j++;
    }
  }

  // Merge adjacent unchanged blocks
  const merged: DeltaDiffBlock[] = [];
  for (const b of blocks) {
    if (
      merged.length > 0 &&
      merged[merged.length - 1].type === b.type &&
      b.type === "unchanged"
    ) {
      const last = merged[merged.length - 1];
      last.endLine = b.endLine;
      last.content += "\n\n" + b.content;
    } else {
      merged.push(b);
    }
  }

  return merged;
}

/**
 * Compute difficulty (est. tokens per paragraph) — simple char length heuristic
 */
function difficulty(p: Paragraph): number {
  return p.content.length;
}

/**
 * Compute diff diagnosis: positive / negative / neutral
 */
function computeDiagnostic(
  added: DeltaDiffBlock[],
  removed: DeltaDiffBlock[]
): "positive" | "negative" | "neutral" {
  let netChange = 0;
  for (const b of added) netChange += difficulty(b);
  for (const b of removed) netChange -= difficulty(b);
  if (netChange > 0.5) return "positive";
  if (netChange < -0.5) return "negative";
  return "neutral";
}

/**
 * Public API: compute paragraph-level diff for two baselines and generate a health delta summary
 */
export function computeDiff(
  baseline1: BaselineContent,
  baseline2: BaselineContent
): DiffResult {
  const para1 = splitToParagraphs(baseline1.responseText);
  const para2 = splitToParagraphs(baseline2.responseText);

  const added = computeBlockDiff(para1, para2).filter(
    (b) => b.type === "added"
  ) as DeltaDiffBlock[];
  const removed = computeBlockDiff(para2, para1).filter(
    (b) => b.type === "removed"
  ) as DeltaDiffBlock[];
  const unchanged = computeBlockDiff(para1, para2).filter(
    (b) => b.type === "unchanged"
  ) as DeltaDiffBlock[];

  const summary = {
    additions: added.length,
    deletions: removed.length,
    unchanged: unchanged.length
  };

  const diagnostic = computeDiagnostic(added, removed);
  return {
    added,
    removed,
    unchanged,
    summary
  };
}

/**
 * Public API: generate an AI-assisted health delta summary
 * In v1, this is a lightweight generative pass; in later versions we may lift to an LLM call you control.
 */
export async function generateHealthDeltaSummary(
  baseline1: BaselineContent,
  baseline2: BaselineContent,
  diagnostics: DiffResult
): Promise<string> {
  const para1 = splitToParagraphs(baseline1.responseText);
  const para2 = splitToParagraphs(baseline2.responseText);
  const added = diagnostics.added;
  const unchangedCount = diagnostics.summary.unchanged;
  const addedContent = added.map((b) => b.content).join("\n\n");
  const netChange = added.length - diagnostics.summary.deletions;

  const summary = await summarizeChanges(
    para1,
    para2,
    addedContent,
    unchangedCount,
    netChange
  );
  return summary;
}

async function summarizeChanges(
  para1: Paragraph[],
  para2: Paragraph[],
  addedContent: string,
  unchangedCount: number,
  netChange: number
): Promise<string> {
  let narrative = "";

  // Simple heuristic: detect focus areas
  const lines1 = para1.map((p) => p.content.toLowerCase());
  const lines2 = para2.map((p) => p.content.toLowerCase());
  const uniqueToNew = new Set<string>();
  const tags1 = extractTags(lines1);
  const tags2 = extractTags(lines2);
  const newTags = tags2.filter((t) => !tags1.includes(t));
  const newTagList = newTags.length > 0 ? `new tags: ${newTags.join(", ")}` : "";

  narrative += `Paragraph-level diff with ${added.length} additions and ${diagnostics.summary.deletions} deletions; ${unchangedCount} unchanged paragraphs.`;
  narrative += ` \n\n`;

  narrative += addedContent.slice(0, 500);
  narrative += ` ...`;

  if (netChange > 0) {
    narrative += ` \n\nNet increase of ${netChange} added paragraphs.`;
  } else if (netChange < 0) {
    narrative += ` \n\nNet decrease of ${Math.abs(netChange)} paragraphs.`;
  } else {
    narrative += ` \n\nNo net change in paragraph count.`;
  }

  if (newTagList) {
    narrative += ` \n\n${newTagList}`;
  }

  return narrative;
}

function extractTags(lines: string[]): string[] {
  const tags = new Set<string>();
  for (const line of lines) {
    if (/^#+\s+(performance|security|quality|architecture|refactor|testing|docs|api|config)\s*$/i.test(line)) {
      const m = line.match(/#+\s+(performance|security|quality|architecture|refactor|testing|docs|api|config)\s*$/i);
      if (m) tags.add(m[1]);
    }
  }
  return Array.from(tags);
}