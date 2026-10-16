/**
 * THE on-prem declaration of Anthropic's model line — every family and its releases,
 * newest first. Each table that used to spell Claude ids out by hand (the default
 * aliases, the onboarding default, the Claude CLI aliases, the "modern model" filter,
 * forward-compat templates, the short-version alias) is DERIVED from this one list, so
 * a release is added here once and every one of them follows.
 *
 * Ids follow Anthropic's rule: `claude-<family>-<major>-<minor>` (`claude-opus-5-5`), with
 * a whole-number release spelled without a minor (`claude-opus-5`).
 */

export const ANTHROPIC_FAMILIES = ["opus", "sonnet", "haiku", "fable"] as const;
export type AnthropicFamily = (typeof ANTHROPIC_FAMILIES)[number];

/** Releases per family, NEWEST FIRST — the head is the family's current model. */
export const ANTHROPIC_RELEASES: Readonly<Record<AnthropicFamily, readonly string[]>> = {
  opus: ["5.5", "5", "4.8", "4.7", "4.6", "4.5", "4.1", "4"],
  sonnet: ["5.5", "5", "4.6", "4.5", "4.1", "4.0"],
  haiku: ["5.5", "4.5", "3.5"],
  fable: ["5.1", "5"],
};

type Version = readonly [major: number, minor: number];

function parseVersion(version: string): Version {
  const [major, minor] = version.split(".");
  return [Number(major), Number(minor ?? 0)];
}

function compareVersions(a: Version, b: Version): number {
  return a[0] - b[0] || a[1] - b[1];
}

/** The API id of one release: `("opus", "5.5")` → `claude-opus-5-5`. Pure. */
export function anthropicModelId(family: AnthropicFamily, version: string): string {
  return `claude-${family}-${version.replace(".", "-")}`;
}

/** The family's CURRENT model id (the head of its release list). Pure. */
export function currentAnthropicModelId(family: AnthropicFamily): string {
  return anthropicModelId(family, ANTHROPIC_RELEASES[family][0]);
}

/**
 * Anthropic's short version spelling — `opus-5.5`, `sonnet-4.6`, `fable-5.1` — resolved
 * to the dashed API id by rule, so a release not yet listed above still resolves.
 * Returns `undefined` when the input is not that spelling. Pure.
 */
export function resolveAnthropicShortAlias(raw: string): string | undefined {
  const match = /^(opus|sonnet|haiku|fable)-(\d+)\.(\d+)$/.exec(raw.trim().toLowerCase());
  return match ? `claude-${match[1]}-${match[2]}-${match[3]}` : undefined;
}

/** A Claude id read into its parts. `separator` keeps the requested spelling (`-` or
 *  `.`) and `suffix` anything after the version (`-thinking`, a date). */
export interface ParsedAnthropicId {
  family: AnthropicFamily;
  version: Version;
  separator: "-" | ".";
  suffix: string;
}

const CLAUDE_ID = /^claude-(opus|sonnet|haiku|fable)-(\d+)(?:([-.])(\d{1,2})(?=-|$))?(-.*)?$/;

/** Parse `claude-opus-4-6-thinking`, `claude-sonnet-4.6-20260219`, `claude-opus-5`. Pure. */
export function parseAnthropicModelId(id: string): ParsedAnthropicId | undefined {
  const match = CLAUDE_ID.exec(id.trim().toLowerCase());
  if (!match) {
    return undefined;
  }
  return {
    family: match[1] as AnthropicFamily,
    version: [Number(match[2]), Number(match[4] ?? 0)],
    separator: match[3] === "." ? "." : "-",
    suffix: match[5] ?? "",
  };
}

/**
 * Template ids a not-yet-catalogued Claude id can borrow its metadata from: every OLDER
 * release of the same family, newest first, in the requested spelling and with the
 * requested suffix first, then bare. Pure.
 */
export function olderAnthropicTemplateIds(id: string): string[] {
  const parsed = parseAnthropicModelId(id);
  if (!parsed) {
    return [];
  }
  const older = ANTHROPIC_RELEASES[parsed.family].filter(
    (v) => compareVersions(parseVersion(v), parsed.version) < 0,
  );
  const spell = (v: string) => `claude-${parsed.family}-${v.replace(".", parsed.separator)}`;
  const withSuffix = parsed.suffix ? older.map((v) => `${spell(v)}${parsed.suffix}`) : [];
  return [...new Set([...withSuffix, ...older.map(spell)])];
}

/** Ids of every release at or after `minVersion` — the "modern" line. Pure. */
export function anthropicModelIdsSince(minVersion: string): string[] {
  const floor = parseVersion(minVersion);
  return ANTHROPIC_FAMILIES.flatMap((family) =>
    ANTHROPIC_RELEASES[family]
      .filter((v) => compareVersions(parseVersion(v), floor) >= 0)
      .map((v) => anthropicModelId(family, v)),
  );
}

/**
 * Every spelling of every release mapped onto its bare family word — what the Claude
 * Code CLI's `--model` accepts (`opus` / `sonnet` / `haiku` / `fable` = that family's
 * newest). Covers the family word, the short spelling (`opus-5.5`) and the API id. Pure.
 */
export function anthropicFamilyAliases(): Record<string, AnthropicFamily> {
  const out: Record<string, AnthropicFamily> = {};
  for (const family of ANTHROPIC_FAMILIES) {
    out[family] = family;
    for (const version of ANTHROPIC_RELEASES[family]) {
      out[`${family}-${version}`] = family;
      out[anthropicModelId(family, version)] = family;
    }
  }
  return out;
}
