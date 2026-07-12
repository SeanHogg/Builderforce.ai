import minimatch from "minimatch";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import type { Type } from "@sinclair/typebox";
import { DiffSummaryError } from "./errors.js";

const DEFAULT_CATEGORIES: readonly CategoryRule[] = [
  {
    category: "test",
    patterns: ["**/*.test.*", "**/*.spec.*", "**/test/**", "**/tests/**", "**/__tests__/**", "**/_test.*"],
  },
  {
    category: "docs",
    patterns: ["**/*.md", "**/*.mdx", "**/*.rst", "**/*.txt", "**/docs/**", "**/documentation/**", "LICENSE*", "CHANGELOG*"],
  },
  {
    category: "migration",
    patterns: ["**/migrations/**", "**/migrate/**", "**/*.migration.*", "**/*.sql"],
  },
  {
    category: "config",
    patterns: ["**/*.json", "**/*.yaml", "**/*.yml", "**/*.toml", "**/*.ini", "**/.*rc", "**/Makefile", "**/Dockerfile*", "**/*.config.*"],
  },
  {
    category: "asset",
    patterns: ["**/*.png", "**/*.jpg", "**/*.svg", "**/*.gif", "**/*.ico", "**/*.woff*", "**/*.ttf"],
  },
];

/**
 * Minimal parser for .mcp-diff-categories.yml override.
 *
 * Recognized format:
 *   glob/path: category
 *   wildcard/path: anotherCategory
 */
function parseYamlOverride(content: string): CategoryRule[] {
  const lines = content.split("\n");
  const rules: CategoryRule[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!.trim();
    if (!line || line.startsWith("#")) {
      i++;
      continue;
    }
    const match = line.match(/^([^:\s]+):\s*(.+)$/);
    if (!match) {
      i++;
      continue;
    }
    let [pattern, catStr] = match.slice(1);
    // protect base path
    let basePath: string;
    if (pattern.includes("/") || pattern.includes("*") || pattern.includes("?") || pattern.includes("{") || pattern.includes("[")) {
      basePath = pattern;
    } else {
      basePath = `**/${pattern}`;
    }
    // strip quotes? Not needed for strict parsing.
    category = catStr.trim();
    rules.push({ category, patterns: [basePath] });

    // conflate following lines until next assignment
    let addedPatterns: string[] = [basePath];
    i++;
    while (i < lines.length) {
      const nextLine = lines[i] !.trim();
      if (!nextLine || nextLine.startsWith("#")) {
        i++;
        continue;
      }
      const nextMatch = nextLine.match(/^([^:\s]+):\s*(.+)$/);
      if (nextMatch) {
        break;
      }
      // concat path segments
      addedPatterns.push(nextLine);
      i++;
    }
    rules[rules.length - 1] = { category, patterns: addedPatterns };
  }
  return rules;
}

export interface CategoryRule {
  category: Category;
  patterns: string[];
}

export interface ClassificationOptions {
  repoPath: string;
}

export type Category =
  | "sourceCode"
  | "test"
  | "docs"
  | "config"
  | "migration"
  | "asset";

const CATEGORY_ORDINALS: Record<Category, number> = {
  sourceCode: 0,
  test: 1,
  docs: 2,
  config: 3,
  migration: 4,
  asset: 5,
};

export function classify(path: string, options: ClassificationOptions): Category {
  try {
    const overridePath = resolve(options.repoPath, ".mcp-diff-categories.yml");
    const overrideContent = readFileSync(overridePath, "utf-8");
    const overrideRules = parseYamlOverride(overrideContent);
    if (overrideRules.length === 0) {
      return classifyWithoutOverride(path);
    }
    return bestMatch(path, [...DEFAULT_CATEGORIES, ...overrideRules]);
  } catch (err) {
    // If file missing or unparsable, fall back to default
    return classifyWithoutOverride(path);
  }
}

function classifyWithoutOverride(path: string): Category {
  return bestMatch(path, DEFAULT_CATEGORIES);
}

function bestMatch(path: string, rules: readonly CategoryRule[]): Category {
  let bestMatch: CategoryRule | null = null;
  let bestPriority = -1;
  for (const rule of rules) {
    const prior = CATEGORY_ORDINALS[rule.category] ?? -1;
    if (prior <= bestPriority) continue;
    if (matchesAny(rule, path)) {
      bestMatch = rule;
      bestPriority = prior;
    }
  }
  return bestMatch?.category ?? "sourceCode";
}

function matchesAny(rule: CategoryRule, path: string): boolean {
  return rule.patterns.some(p => minimatch(path, p, { dot: true, nocase: true }));
}

export const classifySchema = Type.Object({
  path: Type.String(),
  options: Type.Reference(() => ClassificationOptions),
}) as Type.Infer<typeof classifySchema>;