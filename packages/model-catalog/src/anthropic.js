/**
 * THE declaration of Anthropic's model line — every family and its releases, newest
 * first. Every host derives from it: the on-prem runtime (default aliases, the
 * onboarding default, the Claude CLI aliases, the "modern model" filter, forward-compat
 * templates, the short-version alias) and the Worker gateway (each current model's
 * `supersedes` list). A release is added here once and every one of them follows.
 *
 * Ids follow Anthropic's rule: `claude-<family>-<major>-<minor>` (`claude-opus-5-5`), with
 * a whole-number release spelled without a minor (`claude-opus-5`) — except the 4.0
 * line, whose API alias keeps the `-0` (`claude-opus-4-0`), so it is listed as `4.0`.
 */
export const ANTHROPIC_FAMILIES = ['opus', 'sonnet', 'haiku', 'fable'];
/** Releases per family, NEWEST FIRST — the head is the family's current model. */
export const ANTHROPIC_RELEASES = {
    opus: ['5.5', '5', '4.8', '4.7', '4.6', '4.5', '4.1', '4.0'],
    sonnet: ['5.5', '5', '4.6', '4.5', '4.0'],
    haiku: ['5.5', '4.5'],
    fable: ['5.1', '5'],
};
function parseVersion(version) {
    const [major, minor] = version.split('.');
    return [Number(major), Number(minor ?? 0)];
}
function compareVersions(a, b) {
    return a[0] - b[0] || a[1] - b[1];
}
/** The API id of one release: `("opus", "5.5")` → `claude-opus-5-5`. Pure. */
export function anthropicModelId(family, version) {
    return `claude-${family}-${version.replace('.', '-')}`;
}
/** The family's CURRENT model id (the head of its release list). Pure. */
export function currentAnthropicModelId(family) {
    return anthropicModelId(family, ANTHROPIC_RELEASES[family][0]);
}
/** Ids of every release the family's current model replaces (all but the head),
 *  newest first — what a catalog's `supersedes` list for that model is. Pure. */
export function supersededAnthropicModelIds(family) {
    return ANTHROPIC_RELEASES[family].slice(1).map((version) => anthropicModelId(family, version));
}
/**
 * Anthropic's short version spelling — `opus-5.5`, `sonnet-4.6`, `fable-5.1` — resolved
 * to the dashed API id by rule, so a release not yet listed above still resolves.
 * Returns `undefined` when the input is not that spelling. Pure.
 */
export function resolveAnthropicShortAlias(raw) {
    const match = /^(opus|sonnet|haiku|fable)-(\d+)\.(\d+)$/.exec(raw.trim().toLowerCase());
    return match ? `claude-${match[1]}-${match[2]}-${match[3]}` : undefined;
}
const CLAUDE_ID = /^claude-(opus|sonnet|haiku|fable)-(\d+)(?:([-.])(\d{1,2})(?=-|$))?(-.*)?$/;
/** Parse `claude-opus-4-6-thinking`, `claude-sonnet-4.6-20260219`, `claude-opus-5`. Pure. */
export function parseAnthropicModelId(id) {
    const match = CLAUDE_ID.exec(id.trim().toLowerCase());
    if (!match) {
        return undefined;
    }
    return {
        family: match[1],
        version: [Number(match[2]), Number(match[4] ?? 0)],
        separator: match[3] === '.' ? '.' : '-',
        suffix: match[5] ?? '',
    };
}
/**
 * Template ids a not-yet-catalogued Claude id can borrow its metadata from: every OLDER
 * release of the same family, newest first, in the requested spelling and with the
 * requested suffix first, then bare. Pure.
 */
export function olderAnthropicTemplateIds(id) {
    const parsed = parseAnthropicModelId(id);
    if (!parsed) {
        return [];
    }
    const older = ANTHROPIC_RELEASES[parsed.family].filter((v) => compareVersions(parseVersion(v), parsed.version) < 0);
    const spell = (v) => `claude-${parsed.family}-${v.replace('.', parsed.separator)}`;
    const withSuffix = parsed.suffix ? older.map((v) => `${spell(v)}${parsed.suffix}`) : [];
    return [...new Set([...withSuffix, ...older.map(spell)])];
}
/** Ids of every release at or after `minVersion` — the "modern" line. Pure. */
export function anthropicModelIdsSince(minVersion) {
    const floor = parseVersion(minVersion);
    return ANTHROPIC_FAMILIES.flatMap((family) => ANTHROPIC_RELEASES[family]
        .filter((v) => compareVersions(parseVersion(v), floor) >= 0)
        .map((v) => anthropicModelId(family, v)));
}
/**
 * Retired releases whose API id predates the `claude-<family>-<version>` shape (Haiku
 * 3.5 was `claude-3-5-haiku-…`), so they cannot sit in {@link ANTHROPIC_RELEASES}
 * without minting an id that never existed. Their short spellings still resolve —
 * a config written against them keeps working.
 */
const LEGACY_FAMILY_ALIASES = {
    'haiku-3.5': 'haiku',
    'claude-3-5-haiku': 'haiku',
};
/**
 * Every spelling of every release mapped onto its bare family word — what the Claude
 * Code CLI's `--model` accepts (`opus` / `sonnet` / `haiku` / `fable` = that family's
 * newest). Covers the family word, the short spelling (`opus-5.5`), the API id and the
 * {@link LEGACY_FAMILY_ALIASES}. Pure.
 */
export function anthropicFamilyAliases() {
    const out = { ...LEGACY_FAMILY_ALIASES };
    for (const family of ANTHROPIC_FAMILIES) {
        out[family] = family;
        for (const version of ANTHROPIC_RELEASES[family]) {
            out[`${family}-${version}`] = family;
            out[anthropicModelId(family, version)] = family;
        }
    }
    return out;
}
//# sourceMappingURL=anthropic.js.map