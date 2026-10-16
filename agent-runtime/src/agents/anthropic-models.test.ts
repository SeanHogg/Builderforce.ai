import { describe, expect, it } from "vitest";
import {
  ANTHROPIC_FAMILIES,
  ANTHROPIC_RELEASES,
  anthropicFamilyAliases,
  anthropicModelIdsSince,
  currentAnthropicModelId,
  olderAnthropicTemplateIds,
  parseAnthropicModelId,
  resolveAnthropicShortAlias,
} from "./anthropic-models.js";

describe("anthropic-models — the one release list", () => {
  it("names the current flagships", () => {
    expect(currentAnthropicModelId("opus")).toBe("claude-opus-5-5");
    expect(currentAnthropicModelId("sonnet")).toBe("claude-sonnet-5-5");
    expect(currentAnthropicModelId("haiku")).toBe("claude-haiku-5-5");
    expect(currentAnthropicModelId("fable")).toBe("claude-fable-5-1");
  });

  it("lists every family newest first", () => {
    for (const family of ANTHROPIC_FAMILIES) {
      const versions = ANTHROPIC_RELEASES[family].map((v) => Number.parseFloat(v));
      expect([...versions].sort((a, b) => b - a), family).toEqual(versions);
    }
  });

  it("resolves the short spelling by rule, even for an unlisted release", () => {
    expect(resolveAnthropicShortAlias("Opus-5.5")).toBe("claude-opus-5-5");
    expect(resolveAnthropicShortAlias("opus-6.0")).toBe("claude-opus-6-0");
    expect(resolveAnthropicShortAlias("opus")).toBeUndefined();
  });

  it("parses ids with a minor, without one, and with a suffix or a date", () => {
    expect(parseAnthropicModelId("claude-opus-4-6-thinking")).toEqual({
      family: "opus",
      version: [4, 6],
      separator: "-",
      suffix: "-thinking",
    });
    expect(parseAnthropicModelId("claude-sonnet-4.6-20260219")?.separator).toBe(".");
    expect(parseAnthropicModelId("claude-opus-4-20250514")).toEqual({
      family: "opus",
      version: [4, 0],
      separator: "-",
      suffix: "-20250514",
    });
    expect(parseAnthropicModelId("gpt-5.2")).toBeUndefined();
  });

  it("offers only OLDER releases as forward-compat templates, newest first", () => {
    expect(olderAnthropicTemplateIds("claude-opus-5-5").slice(0, 2)).toEqual(["claude-opus-5", "claude-opus-4-8"]);
    expect(olderAnthropicTemplateIds("claude-opus-4-6-thinking")[0]).toBe("claude-opus-4-5-thinking");
    expect(olderAnthropicTemplateIds("claude-fable-5")).toEqual([]);
  });

  it("derives the modern line and the CLI family words", () => {
    const modern = anthropicModelIdsSince("4.5");
    expect(modern).toContain("claude-opus-5-5");
    expect(modern).toContain("claude-haiku-4-5");
    expect(modern).not.toContain("claude-opus-4-1");
    const aliases = anthropicFamilyAliases();
    expect(aliases["claude-sonnet-5-5"]).toBe("sonnet");
    expect(aliases["fable-5.1"]).toBe("fable");
  });
});
