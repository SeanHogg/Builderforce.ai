/**
 * The Agent Skills specification (https://agentskills.io/specification), as constants
 * and the one name rule everything else leans on.
 *
 * A skill is a FOLDER whose `SKILL.md` opens with YAML frontmatter. Two fields are
 * required — `name` and `description` — and four are optional: `license`,
 * `compatibility`, `metadata` (a string → string map) and `allowed-tools` (a
 * space-delimited list, still experimental in the spec). Everything else in the folder
 * (`scripts/`, `references/`, `assets/`) is loaded only when the body points at it.
 *
 * These limits are the spec's, not ours. A skill that passes here loads in any
 * conforming agent, and one that fails here would be rejected by the stricter ones —
 * which is the whole reason the rule lives in one package instead of in each loader.
 */

/** The file that makes a directory a skill. */
export const SKILL_FILE = "SKILL.md";

/** `name`: 1–64 chars. */
export const SKILL_NAME_MAX = 64;
/** `description`: 1–1024 chars. */
export const SKILL_DESCRIPTION_MAX = 1024;
/** `compatibility`: at most 500 chars. */
export const SKILL_COMPATIBILITY_MAX = 500;

/** The frontmatter keys the spec defines. Any other key is preserved as an extension. */
export const SPEC_FIELDS = ["name", "description", "license", "compatibility", "metadata", "allowed-tools"] as const;

/**
 * Lowercase letters, digits and hyphens; no leading, trailing or consecutive hyphen.
 * Written as segments so "no `--`" and "no edge hyphen" are one property of the
 * pattern rather than three separate checks that can disagree.
 */
const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Whether `name` is a valid spec skill name (charset, hyphen placement AND length). */
export function isValidSkillName(name: string): boolean {
  return name.length > 0 && name.length <= SKILL_NAME_MAX && NAME_PATTERN.test(name);
}

/**
 * Coerce free text into a valid skill name: lowercase, every run of other characters
 * collapsed to one hyphen, edge hyphens dropped, cut to 64 at a segment boundary when
 * one is close enough. Returns '' when nothing usable is left — the caller decides
 * whether that is an error, because only it knows what the text was for.
 */
export function toSkillName(text: string): string {
  const base = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (base.length <= SKILL_NAME_MAX) return base;
  const cut = base.slice(0, SKILL_NAME_MAX);
  const lastHyphen = cut.lastIndexOf("-");
  // Prefer a whole segment, unless that would throw away most of the name.
  return (lastHyphen >= SKILL_NAME_MAX / 2 ? cut.slice(0, lastHyphen) : cut).replace(/-+$/g, "");
}

/** A binary asset (image, font, PDF...) may be at most 5 MiB once decoded. */
export const SKILL_BINARY_FILE_MAX_BYTES = 5 * 1024 * 1024;
/** A whole skill folder (text plus decoded binaries) may be at most 10 MiB. */
export const SKILL_PACKAGE_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Extensions whose files are bytes, not text. Every reader (a browser file picker, a
 * zip extractor, a disk walker) reads such files as base64 instead of decoding them as
 * UTF-8 and destroying them. One list so every reader agrees.
 */
export const SKILL_BINARY_EXTENSIONS: readonly string[] = [
  "png", "jpg", "jpeg", "gif", "webp", "ico", "pdf", "woff", "woff2", "ttf", "otf", "zip", "gz", "mp3", "mp4", "wasm",
];

const BINARY_EXTENSION_SET = new Set(SKILL_BINARY_EXTENSIONS);

/** Whether a skill-folder path names a binary file (by extension). */
export function isBinarySkillPath(path: string): boolean {
  const dot = path.lastIndexOf(".");
  return dot > path.lastIndexOf("/") && BINARY_EXTENSION_SET.has(path.slice(dot + 1).toLowerCase());
}

/**
 * The name the platform's skill-reading tool is advertised to models under —
 * `skills.read` in the built-in catalog, flattened to the gateway-safe form. One
 * constant so the Brain's pin list, the cloud prompt and the catalog cannot drift.
 */
export const SKILL_READ_TOOL_NAME = "builtin_skills_read";
