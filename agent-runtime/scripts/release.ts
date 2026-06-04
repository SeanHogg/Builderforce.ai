#!/usr/bin/env -S node --import tsx
/**
 * Interactive release helper for BuilderForceAgents.
 *
 * Steps:
 *   1. Suggest next version(s) based on today's date + current semver
 *   2. Bump package.json
 *   3. pnpm plugins:sync  (aligns extension versions)
 *   4. Prepend CHANGELOG.md section
 *   5. Optionally bump iOS / Android / macOS app version strings
 *   6. pnpm release:check (dist file + version validation)
 *   7. Optionally commit + tag
 *
 * Usage:
 *   pnpm release
 *   pnpm release -- --dry-run   (print what would happen, write nothing)
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { cancel, confirm, intro, note, outro, select, spinner, text } from "@clack/prompts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ROOT = resolve(import.meta.dirname, "..");
const PKG_PATH = resolve(ROOT, "package.json");
const CHANGELOG_PATH = resolve(ROOT, "CHANGELOG.md");

const DRY = process.argv.includes("--dry-run");

type PackageJson = { name: string; version: string; [k: string]: unknown };

function readPkg(): PackageJson {
  return JSON.parse(readFileSync(PKG_PATH, "utf8")) as PackageJson;
}

function writePkg(pkg: PackageJson): void {
  if (DRY) {
    console.log("[dry] would write package.json version:", pkg.version);
    return;
  }
  writeFileSync(PKG_PATH, `${JSON.stringify(pkg, null, 2)}\n`);
}

function run(cmd: string, label?: string): string {
  if (DRY) {
    console.log(`[dry] would run: ${cmd}`);
    return "";
  }
  const s = spinner();
  if (label) {
    s.start(label);
  }
  try {
    const out = execSync(cmd, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    if (label) {
      s.stop(`✓ ${label}`);
    }
    return out;
  } catch (err: unknown) {
    if (label) {
      s.stop(`✗ ${label}`);
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(msg, { cause: err });
  }
}

// ---------------------------------------------------------------------------
// Version suggestion
// ---------------------------------------------------------------------------

/** Returns YYYY.M.D string for today */
function todayVersion(): string {
  const now = new Date();
  return `${now.getFullYear()}.${now.getMonth() + 1}.${now.getDate()}`;
}

function suggestVersions(current: string): { value: string; label: string; hint?: string }[] {
  const today = todayVersion();
  const betaMatch = current.match(/^(.+)-beta\.(\d+)$/);
  const suggestions: { value: string; label: string; hint?: string }[] = [];

  if (betaMatch) {
    const [, base, nStr] = betaMatch;
    const n = Number(nStr);
    // Same base, next beta
    suggestions.push({
      value: `${base}-beta.${n + 1}`,
      label: `${base}-beta.${n + 1}`,
      hint: "increment beta",
    });
    // Today stable
    suggestions.push({ value: today, label: today, hint: "stable release" });
    // Today beta.1
    suggestions.push({
      value: `${today}-beta.1`,
      label: `${today}-beta.1`,
      hint: "new date, beta.1",
    });
  } else {
    // Current is stable - next beta or new day
    suggestions.push({ value: `${today}-beta.1`, label: `${today}-beta.1`, hint: "today beta.1" });
    suggestions.push({ value: today, label: today, hint: "today stable" });
  }

  suggestions.push({ value: "__custom__", label: "Enter manually…" });
  return suggestions;
}

// ---------------------------------------------------------------------------
// CHANGELOG
// ---------------------------------------------------------------------------

function prependChangelog(
  version: string,
  sections: { changes: string[]; breaking: string[]; fixes: string[] },
): void {
  let entry = `## ${version}\n`;

  if (sections.breaking.length > 0) {
    entry += `\n### Breaking\n\n`;
    for (const line of sections.breaking) {
      entry += `- ${line}\n`;
    }
  }
  if (sections.changes.length > 0) {
    entry += `\n### Changes\n\n`;
    for (const line of sections.changes) {
      entry += `- ${line}\n`;
    }
  }
  if (sections.fixes.length > 0) {
    entry += `\n### Fixes\n\n`;
    for (const line of sections.fixes) {
      entry += `- ${line}\n`;
    }
  }

  entry += "\n";

  if (DRY) {
    console.log("\n[dry] would prepend to CHANGELOG.md:\n" + entry);
    return;
  }

  const existing = readFileSync(CHANGELOG_PATH, "utf8");
  const header = "# Changelog\n\n";
  if (existing.startsWith(header)) {
    writeFileSync(CHANGELOG_PATH, `${header}${entry}${existing.slice(header.length)}`);
  } else {
    writeFileSync(CHANGELOG_PATH, `${header}${entry}${existing.trimStart()}\n`);
  }
}

/** Collect multi-line bullet input: one per line, empty line to finish */
async function collectBullets(prompt: string): Promise<string[]> {
  const raw = await text({
    message: prompt,
    placeholder: "One item per line (press Enter twice when done, or leave blank to skip)",
  });
  if (typeof raw === "symbol" || !raw.trim()) {
    return [];
  }
  return raw
    .split(/\r?\n/)
    .map((l) => l.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Native app version bumping (iOS, Android, macOS)
// ---------------------------------------------------------------------------

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Strips -beta.N — Apple/Android don't support pre-release suffixes. */
function toAppVersion(v: string): string {
  return v.replace(/-beta\.\d+$/, "");
}

/** YYYYMMDD (8 digits) — iOS project.yml + iOS Info.plists. */
function toBundleVersionIOS(v: string): string {
  const [y, m, d] = toAppVersion(v).split(".");
  return `${y}${String(m).padStart(2, "0")}${String(d).padStart(2, "0")}`;
}

/** YYYYMMDD0 (9 digits) — macOS Info.plist + Android versionCode. */
function toBundleVersionLong(v: string): string {
  return `${toBundleVersionIOS(v)}0`;
}

function bumpFileVersions(
  absPath: string,
  updates: Array<{ pattern: RegExp; replacement: string }>,
  label: string,
) {
  let content: string;
  try {
    content = readFileSync(absPath, "utf8");
  } catch {
    console.warn(`  skip ${label} (not found)`);
    return;
  }
  for (const { pattern, replacement } of updates) {
    content = content.replace(pattern, replacement);
  }
  if (DRY) {
    console.log(`[dry] would update ${label}`);
  } else {
    writeFileSync(absPath, content);
    console.log(`  ✓ ${label}`);
  }
}

function bumpNativeApps(oldVer: string, newVer: string) {
  const appVer = toAppVersion(newVer);
  const oldAppVer = toAppVersion(oldVer);
  const bundleIOS = toBundleVersionIOS(newVer);
  const bundleLong = toBundleVersionLong(newVer);

  // iOS project.yml — all five targets share the same fields
  bumpFileVersions(
    resolve(ROOT, "apps/ios/project.yml"),
    [
      {
        pattern: new RegExp(`(CFBundleShortVersionString: )"${escapeRegex(oldAppVer)}"`, "g"),
        replacement: `$1"${appVer}"`,
      },
      {
        pattern: /(CFBundleVersion: ")\d{8}(")/g,
        replacement: `$1${bundleIOS}$2`,
      },
    ],
    "apps/ios/project.yml",
  );

  // Android build.gradle.kts
  bumpFileVersions(
    resolve(ROOT, "apps/android/app/build.gradle.kts"),
    [
      {
        pattern: new RegExp(`(versionName = )"${escapeRegex(oldAppVer)}"`, "g"),
        replacement: `$1"${appVer}"`,
      },
      {
        pattern: /(versionCode = )\d+/g,
        replacement: `$1${bundleLong}`,
      },
    ],
    "apps/android/app/build.gradle.kts",
  );

  // iOS Info.plists (XML, 8-digit bundle version)
  for (const rel of [
    "apps/ios/Sources/Info.plist",
    "apps/ios/ShareExtension/Info.plist",
    "apps/ios/Tests/Info.plist",
    "apps/ios/WatchApp/Info.plist",
    "apps/ios/WatchExtension/Info.plist",
  ]) {
    bumpFileVersions(
      resolve(ROOT, rel),
      [
        {
          pattern: new RegExp(
            `(<key>CFBundleShortVersionString</key>\\s*<string>)${escapeRegex(oldAppVer)}(</string>)`,
            "g",
          ),
          replacement: `$1${appVer}$2`,
        },
        {
          pattern: /(<key>CFBundleVersion<\/key>\s*<string>)\d{8}(<\/string>)/g,
          replacement: `$1${bundleIOS}$2`,
        },
      ],
      rel,
    );
  }

  // macOS Info.plist (XML, 9-digit bundle version)
  bumpFileVersions(
    resolve(ROOT, "apps/macos/Sources/BuilderForceAgents/Resources/Info.plist"),
    [
      {
        pattern: new RegExp(
          `(<key>CFBundleShortVersionString</key>\\s*<string>)${escapeRegex(oldAppVer)}(</string>)`,
          "g",
        ),
        replacement: `$1${appVer}$2`,
      },
      {
        pattern: /(<key>CFBundleVersion<\/key>\s*<string>)\d{9}(<\/string>)/g,
        replacement: `$1${bundleLong}$2`,
      },
    ],
    "apps/macos/Sources/BuilderForceAgents/Resources/Info.plist",
  );
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

function gitStatus(): string {
  try {
    return execSync("git status --short", { cwd: ROOT, encoding: "utf8" });
  } catch {
    return "";
  }
}

function uncommittedFiles(): string[] {
  return gitStatus()
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  intro("🦞 BuilderForceAgents release helper" + (DRY ? " [DRY RUN]" : ""));

  const pkg = readPkg();
  const prevVersion = pkg.version;
  note(`Current version: ${prevVersion}`, "package.json");

  // ── 1. Pick version ───────────────────────────────────────────────────────
  const versionChoices = suggestVersions(pkg.version);
  const versionPick = await select({
    message: "New version:",
    options: versionChoices,
  });
  if (typeof versionPick === "symbol") {
    cancel("Cancelled");
    process.exit(0);
  }

  let nextVersion: string;
  if (versionPick === "__custom__") {
    const custom = await text({
      message: "Enter version (format: YYYY.M.D or YYYY.M.D-beta.N):",
      placeholder: `${todayVersion()}-beta.1`,
      validate(v) {
        if (!/^\d{4}\.\d+\.\d+(-beta\.\d+)?$/.test(v.trim())) {
          return "Expected YYYY.M.D or YYYY.M.D-beta.N";
        }
      },
    });
    if (typeof custom === "symbol") {
      cancel("Cancelled");
      process.exit(0);
    }
    nextVersion = custom.trim();
  } else {
    nextVersion = versionPick;
  }

  // ── 2. Collect changelog entries ─────────────────────────────────────────
  note(
    "Enter changelog entries (multi-line ok, one bullet per line, blank to skip a section).",
    "CHANGELOG",
  );
  const changes = await collectBullets("Changes (new features / improvements):");
  const breaking = await collectBullets("Breaking changes:");
  const fixes = await collectBullets("Fixes:");

  const hasCLEntry = changes.length + breaking.length + fixes.length > 0;
  if (!hasCLEntry) {
    const proceed = await confirm({
      message: "No changelog entries — continue anyway?",
      initialValue: false,
    });
    if (typeof proceed === "symbol" || !proceed) {
      cancel("Aborted");
      process.exit(0);
    }
  }

  // ── 3. Native app versions ────────────────────────────────────────────────
  const isBeta = nextVersion.includes("beta");
  const doApps = await confirm({
    message: `Bump iOS / Android / macOS app versions to ${toAppVersion(nextVersion)}?`,
    initialValue: !isBeta,
  });
  if (typeof doApps === "symbol") {
    cancel("Cancelled");
    process.exit(0);
  }

  // ── 4. Confirm plan ───────────────────────────────────────────────────────
  const lines = [
    `  ${prevVersion}  →  ${nextVersion}`,
    hasCLEntry
      ? `  CHANGELOG: ${changes.length} changes, ${breaking.length} breaking, ${fixes.length} fixes`
      : "  CHANGELOG: skipped",
    `  pnpm plugins:sync`,
    doApps
      ? `  native apps: iOS / Android / macOS → ${toAppVersion(nextVersion)}`
      : "  native apps: skipped",
    `  pnpm format && pnpm check`,
    `  pnpm release:check`,
  ];
  note(lines.join("\n"), "Plan");

  const go = await confirm({ message: "Proceed?", initialValue: true });
  if (typeof go === "symbol" || !go) {
    cancel("Aborted");
    process.exit(0);
  }

  // ── 5. Apply ──────────────────────────────────────────────────────────────
  pkg.version = nextVersion;
  writePkg(pkg);

  if (hasCLEntry) {
    prependChangelog(nextVersion, { changes, breaking, fixes });
    if (!DRY) {
      console.log(`✓ Prepended CHANGELOG.md`);
    }
  }

  run("pnpm plugins:sync", "Syncing extension versions (pnpm plugins:sync)");

  if (doApps) {
    if (!DRY) {
      console.log("\nBumping native app versions…");
    }
    bumpNativeApps(prevVersion, nextVersion);
  }

  run("pnpm format", "Formatting (pnpm format)");
  run("pnpm check", "Checking format / types / lint (pnpm check)");
  run("pnpm release:check", "Validating release (pnpm release:check)");

  // ── 6. Git commit + tag ───────────────────────────────────────────────────
  const dirty = uncommittedFiles();
  if (dirty.length > 0) {
    const doCommit = await confirm({
      message: `Commit ${dirty.length} changed file(s) and tag v${nextVersion}?`,
      initialValue: true,
    });
    if (typeof doCommit !== "symbol" && doCommit) {
      run(`git add -A && git commit -m "chore: release ${nextVersion}"`, "git commit");
      run(`git tag -a "v${nextVersion}" -m "Release ${nextVersion}"`, "git tag");
      note(`Tag v${nextVersion} created.\nPush with: git push && git push --tags`, "Done");
    }
  }

  outro(`🦞 ${nextVersion}${DRY ? " (dry run — nothing written)" : " ready to ship!"}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
