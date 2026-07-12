// File classifier — PRD FR-3.
//
// Every file in the diff is assigned exactly one category from the closed set,
// in strict priority order (first match wins). Classification is case-insensitive.

import type { FileCategory } from "./types.js";

/**
 * Classify a repository-relative file path into exactly one `FileCategory`.
 *
 * @param filePath - Unix-style relative path, e.g. "src/feature.ts" or "docs/README.md".
 * @returns The matched `FileCategory`.
 */
export function classifyFile(filePath: string): FileCategory {
  const lower = filePath.toLowerCase();
  const base = lower.slice(lower.lastIndexOf("/") + 1);

  // -----------------------------------------------------------------------
  // 1) TEST — path contains /test/, /__tests__/, /fixtures/, OR filename
  //    contains ".test." or ".spec." (e.g. foo.test.ts, bar.spec.js).
  // -----------------------------------------------------------------------
  if (
    lower.includes("/test/") ||
    lower.includes("/__tests__/") ||
    lower.includes("/fixtures/")
  ) {
    return "test";
  }
  if (base.includes(".test.") || base.includes(".spec.")) {
    return "test";
  }

  // -----------------------------------------------------------------------
  // 2) DOCS — extension .md/.mdx/.rst/.txt OR path contains /docs/, /documentation/
  // -----------------------------------------------------------------------
  if (lower.includes("/docs/") || lower.includes("/documentation/")) {
    return "docs";
  }
  const lastDot = lower.lastIndexOf(".");
  const ext = lastDot >= 0 ? lower.slice(lastDot) : "";
  const docsExts = [".md", ".mdx", ".rst", ".txt"];
  if (docsExts.includes(ext)) return "docs";

  // -----------------------------------------------------------------------
  // 3) CONFIG — extension .json/.yaml/.yml/.toml/.ini/.env* OR well-known
  //    filenames (Dockerfile, .dockerignore, Makefile, .gitignore, eslint/prettierrc)
  // -----------------------------------------------------------------------
  // .env, .env.local, .env.production, etc.
  if (ext === ".env" || ext.startsWith(".env.")) return "config";
  // Also catch patterns like ".env", ".env.production" where ext parsing is wrong:
  // If basename is ".env" or starts with ".env." → config.
  if (base === ".env" || base.startsWith(".env.")) return "config";
  const configExts = [".json", ".yaml", ".yml", ".toml", ".ini"];
  if (configExts.includes(ext)) return "config";
  // Well-known config filenames
  if (base === "dockerfile") return "config";
  if (base === "makefile") return "config";
  if (base === ".dockerignore") return "config";
  if (base === ".gitignore") return "config";
  if (base.startsWith(".eslintrc")) return "config";
  if (base.startsWith(".prettierrc")) return "config";

  // -----------------------------------------------------------------------
  // 4) MIGRATION — path matches /migrations/, /migrate/, OR filename
  //    matches \d+_*.sql
  // -----------------------------------------------------------------------
  if (lower.includes("/migrations/") || lower.includes("/migrate/")) {
    return "migration";
  }
  if (/^\d+_.*\.sql$/.test(base)) return "migration";
  // Also: *.sql file inside migrations/migrate is already covered by path.
  if (ext === ".sql" && (lower.includes("migration") || lower.includes("migrate"))) {
    return "migration";
  }

  // -----------------------------------------------------------------------
  // 5) ASSET — well-known binary/media asset extensions
  // -----------------------------------------------------------------------
  const assetExts = [
    ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico",
    ".mp4", ".woff", ".woff2", ".ttf", ".eot", ".pdf",
  ];
  if (assetExts.includes(ext)) return "asset";

  // -----------------------------------------------------------------------
  // 6) SOURCE — everything else
  // -----------------------------------------------------------------------
  return "source";
}
