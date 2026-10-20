/**
 * THE regression this ticket exists for.
 *
 * A person can only export and repair a durable dead letter if TWO independent
 * things are true: `activate` registers the command, and the manifest declares
 * it so the Command Palette lists it. Either one alone leaves the feature
 * unreachable, and neither is visible from inside `deadLetterCommand.ts`.
 *
 * So nothing here reads this file to check itself. Every case opens the real
 * host — `extension.ts` — the real `package.json`, and all five `package.nls*.json`
 * catalogs, exactly like the `installLocalDomainTools` host cases do. Deleting
 * the registration or the manifest entry fails this suite.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EXPORT_DEAD_LETTERS_COMMAND } from "./deadLetterCommand";

const HOST_FILE = "./extension.ts";
const MANIFEST_FILE = "../package.json";
const NLS_FILES = [
  "../package.nls.json",
  "../package.nls.de.json",
  "../package.nls.es.json",
  "../package.nls.fr.json",
  "../package.nls.zh-cn.json",
] as const;

/** The `%command.*%` key the manifest declares the command title under. */
const TITLE_KEY = "command.exportDeadLetters";

function read(file: string): string {
  return readFileSync(new URL(file, import.meta.url), "utf8");
}

function manifest(): { contributes?: { commands?: { command?: string; title?: string }[] } } {
  return JSON.parse(read(MANIFEST_FILE));
}

function declaredCommand(): { command?: string; title?: string } | undefined {
  return manifest().contributes?.commands?.find((entry) => entry.command === EXPORT_DEAD_LETTERS_COMMAND);
}

function activateBody(): string {
  const source = read(HOST_FILE);
  const start = source.indexOf("export function activate(");
  expect(start, `${HOST_FILE} has no activate export`).toBeGreaterThan(-1);
  const rest = source.slice(start);
  const next = rest.slice(1).search(/\n(?:export )?(?:async )?function \w/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

describe("a person can reach the dead-letter export command", () => {
  it("registers the command on the activation path, inside activate's own body", () => {
    const body = activateBody();
    // The id is the constant, not a string literal typed again here.
    expect(body).toMatch(/vscode\.commands\.registerCommand\(\s*EXPORT_DEAD_LETTERS_COMMAND\b/);
    // …and it is disposed with the extension, not leaked.
    expect(body).toMatch(/context\.subscriptions\.push\(\s*(?:[^;]*?)registerCommand\(\s*EXPORT_DEAD_LETTERS_COMMAND/);
    // The handler runs the real export/repair entry point.
    expect(body).toMatch(/await runExportDeadLetters\(/);
    // Registered AT activation, not lazily behind a first call — a person must be
    // able to find it in the palette without anything having triggered it first.
    // activate's own body statements sit at exactly two spaces of indent, so a
    // registration nested inside an `if` or a loop would be indented deeper.
    const lines = body.split("\n");
    const at = lines.findIndex((line) => line.includes("registerCommand(EXPORT_DEAD_LETTERS_COMMAND"));
    expect(at, `${HOST_FILE} does not register the export command`).toBeGreaterThan(-1);
    expect(lines[at].trimEnd()).toMatch(/^ {4}vscode\.commands\.registerCommand\(/);
    expect(lines[at - 1], "the registration is not a top-level activation statement").toMatch(
      /^ {2}context\.subscriptions\.push\(\s*$/,
    );
  });

  it("imports the command from the landed module rather than redeclaring it", () => {
    const source = read(HOST_FILE);
    expect(source).toMatch(
      /import\s*\{[^}]*EXPORT_DEAD_LETTERS_COMMAND[^}]*\}\s*from\s*"\.\/deadLetterCommand"/,
    );
    expect(source).not.toMatch(/registerCommand\(\s*"builderforce\.exportDeadLetters"/);
  });

  it("uses the one command id the module exports", () => {
    // The manifest, the host and the module must not drift into three ids.
    expect(EXPORT_DEAD_LETTERS_COMMAND).toBe("builderforce.exportDeadLetters");
    expect(read("./deadLetterCommand.ts")).toContain(
      `export const EXPORT_DEAD_LETTERS_COMMAND = "${EXPORT_DEAD_LETTERS_COMMAND}";`,
    );
    expect(declaredCommand()?.command).toBe(EXPORT_DEAD_LETTERS_COMMAND);
  });

  it("does not let the export path send, flush or retry anything", () => {
    const body = activateBody();
    const handler = body.slice(body.indexOf("registerCommand(EXPORT_DEAD_LETTERS_COMMAND"));
    // The command is export + offer repair. It never reaches the network itself.
    expect(handler).not.toMatch(/\bfetch\(/);
    expect(handler).not.toMatch(/\bflush\b/);
    // Failures are surfaced, not swallowed.
    expect(handler).toMatch(/catch \(error\)/);
    expect(handler).toMatch(/surfaceError\(/);
  });

  it("registers exactly one command for the export id", () => {
    const body = activateBody();
    const registrations = body.match(/registerCommand\(\s*EXPORT_DEAD_LETTERS_COMMAND/g) ?? [];
    expect(registrations).toHaveLength(1);
  });
});

describe("the manifest puts the command in the Command Palette", () => {
  it("declares it under contributes.commands", () => {
    const declared = declaredCommand();
    expect(declared, `${EXPORT_DEAD_LETTERS_COMMAND} is not declared in package.json`).toBeDefined();
    expect(declared?.command).toBe(EXPORT_DEAD_LETTERS_COMMAND);
    // A hardcoded title is what this gap is: every neighbouring command resolves
    // its title through package.nls, so the command is translatable.
    expect(declared?.title).toBe(`%${TITLE_KEY}%`);
  });

  it("resolves the title key to non-empty text in ALL FIVE catalogs", () => {
    const resolved = new Map<string, string>();
    for (const file of NLS_FILES) {
      const catalog = JSON.parse(read(file)) as Record<string, unknown>;
      const title = catalog[TITLE_KEY];
      expect(typeof title, `${file} is missing ${TITLE_KEY}`).toBe("string");
      expect(String(title).trim(), `${file} has an empty ${TITLE_KEY}`).not.toBe("");
      // A placeholder left in a catalog is not a translation — it must be text.
      expect(String(title)).not.toMatch(/^%.*%$/);
      expect(String(title)).toContain("BuilderForce");
      // Each catalog carries its own locale's wording, in that locale's script.
      expect(title, `${file} left ${TITLE_KEY} in English`).not.toBe(resolved.get("en"));
      resolved.set(file === NLS_FILES[0] ? "en" : file, String(title));
    }
    // Every locale was actually visited: five files, five distinct entries read.
    expect(NLS_FILES).toHaveLength(5);
    expect(resolved.size).toBe(5);
    // The default catalog is what VS Code resolves the manifest's %key% against.
    expect(JSON.parse(read(NLS_FILES[0]))[TITLE_KEY]).toBe("BuilderForce: Export Dead Letters");
    // The localized ones are genuinely translated, not copies of the English.
    expect(new Set([...resolved.values()]).size).toBeGreaterThan(1);
  });

  it("does not leave a catalog missing a key the other four declare", () => {
    const keys = NLS_FILES.map((file) => new Set(Object.keys(JSON.parse(read(file)))));
    for (const keysInCatalog of keys) {
      for (const key of keysInCatalog) {
        for (const set of keys) expect(set.has(key), `${key} missing from a catalog`).toBe(true);
      }
    }
  });
});