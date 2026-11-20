import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createComposerCommandRegistry, parseComposerInput } from "@seanhogg/builderforce-brain-embedded/composerCommands";
import { listKitOptions, NAMED_KITS } from "@builderforce/ide-templates/kits";

vi.mock("vscode", () => ({
  l10n: { t: (message: string, ...args: unknown[]) => message.replace(/\{(\d+)\}/g, (_, index: string) => String(args[Number(index)])) },
}));

import { buildComposerCommands, starterKitChoices, starterKitExtraChoices } from "./entries";
import { composerCommandText } from "./labels";

const context = { hasWorkspace: true, noWorkspaceReason: "open a folder", stopLabel: "stop it", trustLabel: "trust it" };

describe("composer command entries", () => {
  it("offers every named kit, every frontend × backend pair and each frontend alone, from the ide-templates registry", () => {
    const values = starterKitChoices().map((choice) => choice.value);
    const { frontends, backends } = listKitOptions();
    for (const kit of NAMED_KITS) expect(values).toContain(kit);
    const short = (part: { id: string; aliases: readonly string[] }) => part.aliases[0] ?? part.id;
    for (const frontend of frontends) {
      expect(values).toContain(short(frontend));
      for (const backend of backends) expect(values).toContain(`${short(frontend)}-${short(backend)}`);
    }
    expect(new Set(values).size).toBe(values.length);
  });

  it("offers the registry's extras for --with", () => {
    expect(starterKitExtraChoices().map((choice) => choice.value)).toEqual(listKitOptions().extras.map((extra) => extra.id));
  });

  it("disables every command, with the reason, when no folder is open", () => {
    for (const command of buildComposerCommands({ ...context, hasWorkspace: false })) {
      expect(command.availability).toEqual({ ok: false, reason: "open a folder" });
    }
  });

  it("offers the manifest's environments and stop to /launch, and accepts any name without a manifest", () => {
    const withEnvs = buildComposerCommands({ ...context, environments: ["local", "staging"] }).find((command) => command.id === "launch")!;
    expect(withEnvs.args[0]!.choices?.map((choice) => choice.value)).toEqual(["local", "staging", "stop", "trust"]);
    const without = buildComposerCommands(context).find((command) => command.id === "launch")!;
    expect(without.args[0]!.choices).toBeUndefined();
  });

  it("registers cleanly and parses each command's own example", () => {
    const registry = createComposerCommandRegistry(buildComposerCommands({ ...context, environments: ["local"] }), composerCommandText());
    for (const command of registry.list()) {
      expect(parseComposerInput(command.example, registry)).toMatchObject({ kind: "command", id: command.id });
    }
  });
});

describe("composer command copy", () => {
  const source = readFileSync(new URL("./labels.ts", import.meta.url), "utf8");
  const keys = [...source.matchAll(/\bt\("((?:[^"\\]|\\.)*)"/g)].map((match) => JSON.parse(`"${match[1]}"`) as string);

  it("finds the strings it checks", () => {
    expect(keys.length).toBeGreaterThan(40);
  });

  it.each(["", ".de", ".es", ".fr", ".zh-cn"])("has every string in bundle.l10n%s.json, translated", (locale) => {
    const catalog = JSON.parse(readFileSync(new URL(`../../l10n/bundle.l10n${locale}.json`, import.meta.url), "utf8")) as Record<string, string>;
    for (const key of keys) expect(catalog[key], `${locale}: ${key}`).toBeTruthy();
    if (locale) {
      // Real translations, not English copies (a short word such as "Actions" may legitimately match).
      const copied = keys.filter((key) => catalog[key] === key && key.length > 12);
      expect(copied, `${locale} copies English`).toEqual([]);
    }
  });
});
