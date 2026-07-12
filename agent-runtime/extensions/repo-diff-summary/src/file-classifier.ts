// File classifier — PRD FR-3
// Classifies a single file path into exactly one of the six canonical categories.
// Rules are applied top-to-bottom in priority order; the first match wins.
// All matching is case-insensitive.

import { type FileCategory } from "./types.js";

// ---------------------------------------------------------------------------
// Rule helpers
// ---------------------------------------------------------------------------

/** Match the final part of a path or filename against an array of patters. */
function pathMatches(
  path: string,
  segPatterns: ReadonlyArray<string>,
  extPatterns?: ReadonlyArray<string>,
  fileNameExact?: ReadonlyArray<string>,
): boolean {
  const lower = path.toLowerCase();
  // Segment patterns: any path segment matches
  for (const pat of segPatterns) {
    if (lower.includes(pat)) return true;
  }
  // Extension patterns
  if (extPatterns) {
    const ext = lower.slice(lower.lastIndexOf("."));
    for (const ex of extPatterns) {
      if (ext === ex) return true;
    }
  }
  // Exact filename patterns (basename)
  if (fileNameExact) {
    const base = lower.slice(lower.lastIndexOf("/") + 1);
    for (const fn of fileNameExact) {
      if (base === fn || base.match(new RegExp(`^${fn.replace(/\*/g, ".*")}$`))) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Classification rule set (priority order, first-match wins)
// ---------------------------------------------------------------------------

interface Rule {
  category: FileCategory;
  pathSegments?: readonly string[];
  extensions?: readonly string[];
  fileNames?: readonly string[];
}

const RULES: readonly Rule[] = [
  // 1) Test
  {
    category: "test",
    pathSegments: ["/test/", "/__tests__/", "/fixtures/"],
    extensions: [".test.", ".spec."],
    // .test.ts, .spec.ts, .test.js, .spec.js, .test.tsx, .spec.tsx etc.
    // We catch these via the extension pattern which checks for ".test." in the full extension
    // Actually .test.ts -> the last '.' is '.ts', so we need a different check.
    // Let's handle .test.* and .spec.* as path-like segments too.
    fileNames: [],
  },
  // 1b) Handle *.test.* and *.spec.* as filename patterns
  {
    category: "test",
    pathSegments: [],
    extensions: [],
    fileNames: [],
  },
  // 2) Docs
  {
    category: "docs",
    extensions: [".md", ".mdx", ".rst", ".txt"],
    pathSegments: ["/docs/", "/documentation/"],
  },
  // 3) Config
  {
    category: "config",
    extensions: [".json", ".yaml", ".yml", ".toml", ".ini", ".env"],
    fileNames: [
      "dockerfile",
      ".dockerignore",
      "makefile",
      ".gitignore",
      ".eslintrc",
      ".eslintrc.*",
      ".prettierrc",
      ".prettierrc.*",
    ],
    pathSegments: [],
  },
  // 4) Migration
  {
    category: "migration",
    pathSegments: ["/migrations/", "/migrate/"],
    // also catch filenames matching /\d+_*.sql/
    fileNames: [],
  },
  // 5) Asset
  {
    category: "asset",
    extensions: [
      ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico",
      ".mp4", ".woff", ".woff2", ".ttf", ".eot", ".pdf",
    ],
    pathSegments: [],
  },
  // 6) Source — any remaining file
  { category: "source", pathSegments: [], extensions: [], fileNames: [] },
];

/**
 * Classify a file path into exactly one `FileCategory`.
 *
 * @param filePath - Unix-style relative path (e.g. "src/feature.ts").
 * @returns The matched `FileCategory`.
 */
export function classifyFile(filePath: string): FileCategory {
  const lower = filePath.toLowerCase();

  // --- Test (priority 1) ---
  // Path segments: matches /test/, /__tests__/, /fixtures/
  if (
    lower.includes("/test/") ||
    lower.includes("/__tests__/") ||
    lower.includes("/fixtures/")
  ) {
    return "test";
  }
  // Filename: *.test.*, *.spec.*
  const base = lower.slice(lower.lastIndexOf("/") + 1);
  if (
    base.includes(".test.") ||
    base.includes(".spec.")
  ) {
    return "test";
  }

  // --- Docs (priority 2) ---
  const docsExts = [".md", ".mdx", ".rst", ".txt"];
  if (lower.includes("/docs/") || lower.includes("/documentation/")) {
    return "docs";
  }
  const ext = lower.slice(lower.lastIndexOf("."));
  for (const de of docsExts) {
    if (ext === de) return "docs";
  }

  // --- Config (priority 3) ---
  const configExts = [".json", ".yaml", ".yml", ".toml", ".ini"];
  // .env, .env.local, .env.production etc.
  if (ext.startsWith(".env")) return "config";
  for (const ce of configExts) {
    if (ext === ce) return "config";
  }
  const configFileNames = [
    "dockerfile",
    ".dockerignore",
    "makefile",
    ".gitignore",
  ];
  if (configFileNames.includes(base)) return "config";
  // eslintrc/ prettierrc with glob patterns
  if (base.startsWith(".eslintrc") || base.startsWith(".prettierrc")) return "config";

  // --- Migration (priority 4) ---
  if (lower.includes("/migrations/") || lower.includes("/migrate/")) {
    return "migration";
  }
  // Filenames matching \d+_*.sql
  const migrationPattern = /^\d+_.*\.sql$/;
  if (migrationPattern.test(base)) return "migration";

  // --- Asset (priority 5) ---
  const assetExts = [
    ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico",
    ".mp4", ".woff", ".woff2", ".ttf", ".eot", ".pdf",
  ];
  for (const ae of assetExts) {
    if (ext === ae) return "asset";
  }

  // --- Source (priority 6 - catch-all) ---
  return "source";
}
