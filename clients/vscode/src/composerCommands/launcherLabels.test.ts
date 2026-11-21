import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_LAUNCHER_LABELS } from "@seanhogg/builderforce-webcontainers/launcher/server";

// `vscode.l10n.t`'s own formatting: `{name}` from a named-argument object, `{0}` from positional ones.
vi.mock("vscode", () => ({
  l10n: {
    t: (message: string, ...args: unknown[]) => {
      const named = args.length === 1 && typeof args[0] === "object" && args[0] !== null ? (args[0] as Record<string, unknown>) : undefined;
      return message.replace(/\{(\w+)\}/g, (match, key: string) => {
        const value = named ? named[key] : args[Number(key)];
        return value === undefined ? match : String(value);
      });
    },
  },
}));

import { launcherPageLabels } from "./launcherLabels";

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

describe("the launcher page's labels", () => {
  it("covers every label the installed runtime has, worded as its English defaults, placeholders intact", () => {
    const labels = launcherPageLabels() as unknown as Record<string, string>;
    for (const [key, english] of Object.entries(DEFAULT_LAUNCHER_LABELS)) expect(labels[key], key).toBe(english);
  });

  it("includes the newer runtime's copy-diagnostics labels", () => {
    expect(launcherPageLabels()).toMatchObject({ copyDiagnostics: "Copy diagnostics", copyDiagnosticsDone: "Copied", copyDiagnosticsFailed: "Copy failed" });
  });

  it.each(["", ".de", ".es", ".fr", ".zh-cn"])("is translated in bundle.l10n%s.json, with the same placeholders", (locale) => {
    const bundle = JSON.parse(readFileSync(new URL(`../../l10n/bundle.l10n${locale}.json`, import.meta.url), "utf8")) as Record<string, string>;
    for (const english of new Set(Object.values(launcherPageLabels()))) {
      expect(bundle[english], `${locale || "en"}: ${english}`).toBeTruthy();
      expect(placeholders(bundle[english]!), english).toEqual(placeholders(english));
    }
  });
});
