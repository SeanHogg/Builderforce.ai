import type { Capture, Type } from "@sinclair/typebox";
import fg from "fast-glob";
import { union } from "./errors.js";

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
 * Minimal YAML parsing for .mcp-diff-categories.yml override.
 * Handles an override at each glob pattern or at a top level.
 * Errors are COERCED into TOOL_ERRORS (union), not thrown directly.
 */
function parseYamlOverrideOverride(str: string): CategoryRule[] | TOOL_ERRORS {
  try {
    const lines = str.split("\n");
    const rules: CategoryRule[] = [];
    // Simple line-by-line parser.
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!.trim();
      // Skip comments, empty/blank.
      if (!line || line.startsWith("#") || /^[\s\r]+$/.test(line)) continue;
      // Glob: category: path…
      const globMatch = line.match(/^([^\s]+):\s*(.+)$/);
      if (globMatch) {
        const [, glob, category] = globMatch;
        let patternList = [glob];
        // Multi-line patterns after the first line (same category).
        const currentCategory = category.trim().replace(/^["'`]|[`'""]$/g, "").trim();
        for (i++; i < lines.length; i++) {
          const nextLine = lines[i]!;
          const trimmed = nextLine.trim();
          if (!trimmed) break;
          if (trimmed.startsWith("#") || /^[\s\r]+$/.test(trimmed)) continue;
          const multiGlobMatch = trimmed.match(/^([^\s]+):\s*(.+)$/);
          if (multiGlobMatch) {
            break; // Finished this section
          }
          const added patternList = [...patternList, trimmed];
        }
        rules.push({ category: currentCategory, patterns: patternList });
      }
      // Catch-all category without explicit glob lines? (EXAMPLE: "all: path…"). We won't handle for now to keep minimal.
    }
    if (rules.length === 0) return [];
    return rules;
  } catch (err) {
    return new UnexpectedParseError("Failed to parse .mcp-diff-categories.yml: " + String(err));
  }
}

/**
 * Unified error type used by classification module.
 */
type TOOL_ERRORS = TASK_NOT_LINKED | NOT_FOUND | FORBIDDEN | UnexpectedParseError;

type TASK_NOT_LINKED = { kind: "TASK_NOT_LINKED"; message: string };
type NOT_FOUND = { kind: "NOT_FOUND"; message: string };
type FORBIDDEN = { kind: "FORBIDDEN"; message: string };
type UnexpectedParseError = { kind: "UnexpectedParseError"; message: string };

function parseOverrideFile(content: string): CategoryRule[] | TOOL_ERRORS {
  return parseYamlOverrideOverride(content);
}

const CATEGORY_ORDINALS: Record<Category, number> = {
  sourceCode: 0,
  test: 1,
  docs: 2,
  config: 3,
  migration: 4,
  asset: 5,
};

type Category =
  | "sourceCode"
  | "test"
  | "docs"
  | "config"
  | "migration"
  | "asset";

type MatchingRule = {
  category: Category;
  patterns: string[];
  matchIndex: number; // longest path wins
};

export interface ClassificationOptions {
  override: string | TOOL_ERRORS;
  basename: string;
}

/**
 * Classify a path into a category based on override, longest-path glob wins.
 * Returns TOOL_ERRORS for malformed YAML; consumed by the tool layer.
 */
export function classify(path: string, options: ClassificationOptions): Category | TOOL_ERRORS {
  // Resolve override lazily after parse error resolution.
  let overrideRules: CategoryRule[] = [];
  if (options.override !== "TOOL_ERRORS") {
    // Override should be already normalized to CategoryRule[]
    overrideRules = options.override;
  }

  // Determine best matching rule across both defaults and overrides.
  const match = bestMatchRule(path, [...DEFAULT_CATEGORIES, ...overrideRules]);

  if (match === null) {
    return "sourceCode";
  }

  const category = match.category;
  return CATEGORY_ORDINALS[category] <= CATEGORY_ORDINALS.sourceCode ? category : "sourceCode";
}

function bestMatchRule(path: string, rules: readonly CategoryRule[]): MatchingRule | null {
  let longestMatch: MatchingRule | null = null;
  for (const rule of rules) {
    for (let i = 0; i < rule.patterns.length; i++) {
      const pattern = rule.patterns[i]!;
      if (!matchGlob(pattern, path)) continue;
      const { options, error } = matchGlobMeta(pattern, path);
      if (error) continue;
      const matchIndex = options.matchCount + (options.isExtensionMatch ? 0 : -0.1);
      if (!longestMatch || matchIndex > matchGlobMeta(longestMatch.category === "sourceCode" ? "" : "", path).options.matchCount) {
        longestMatch = { category: rule.category, patterns: rule.patterns, matchIndex };
      }
    }
  }
  return longestMatch;
}

function matchGlob(pattern: string, path: string): boolean {
  // fast-glob includes globstar support; we don't restrict delimiters here.
  return fg.sync(pattern, { onlyFiles: false }).includes(path);
}

// Temporary lightweight glob meta-finder (extension-match heuristic)
function matchGlobMeta(pattern: string, path: string): { options: { matchCount: number; isExtensionMatch: boolean }; error: boolean } {
  const noWildcard = !pattern.match(/[*?{}[\]]/);
  if (noWildcard) {
    const exactMatch = pattern === path;
    return { options: { matchCount: exactMatch ? 1 : 0, isExtensionMatch: path.includes(".") && path.endsWith(pattern) }, error: false };
  }
  const matches = fg.sync(pattern, { onlyFiles: false }).map(p => p.replace(/\/+/g, "/"));
  // Multi-pattern simplistic count
  for (const m of matches) {
    // Use String.includes as a rough heuristic; we only evaluate explicitly specified patterns.
    if (path.includes(m)) return { options: { matchCount: 1, isExtensionMatch: false }, error: false };
  }
  return { options: { matchCount: 0, isExtensionMatch: false }, error: false };
}

export interface CategoryRule {
  category: Category;
  patterns: string[];
}