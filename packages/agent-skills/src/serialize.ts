/**
 * Write a {@link SkillManifest} + body back out as a spec SKILL.md.
 *
 * The output is deliberately conservative YAML — every string that could be misread
 * is double-quoted, `metadata` is a block mapping — so any conforming parser, not just
 * this package's, reads back exactly what was written.
 */

import type { SkillManifest } from "./validate.js";

/** Plain is safe only for text no YAML reader could take for anything else. */
function yamlString(value: string): string {
  const plainSafe = /^[A-Za-z0-9][A-Za-z0-9 _.,/()@+-]*$/.test(value)
    && !/^(true|false|null|yes|no|on|off|~)$/i.test(value)
    && !/^[0-9.+-]+$/.test(value)
    && !value.includes(": ")
    && !value.includes(" #");
  return plainSafe ? value : JSON.stringify(value);
}

function yamlValue(value: unknown): string {
  if (typeof value === "string") return yamlString(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null || value === undefined) return "null";
  return JSON.stringify(value);
}

/** Render the SKILL.md text for a manifest and its body. */
export function serializeSkillMarkdown(manifest: SkillManifest, body: string): string {
  const lines = ["---", `name: ${manifest.name}`, `description: ${yamlString(manifest.description)}`];
  if (manifest.license) lines.push(`license: ${yamlString(manifest.license)}`);
  if (manifest.compatibility) lines.push(`compatibility: ${yamlString(manifest.compatibility)}`);
  if (manifest.metadata && Object.keys(manifest.metadata).length > 0) {
    lines.push("metadata:");
    for (const [k, v] of Object.entries(manifest.metadata)) lines.push(`  ${yamlString(k)}: ${yamlString(v)}`);
  }
  if (manifest.allowedTools && manifest.allowedTools.length > 0) {
    lines.push(`allowed-tools: ${yamlString(manifest.allowedTools.join(" "))}`);
  }
  for (const [k, v] of Object.entries(manifest.extensions)) {
    if (v === undefined) continue;
    lines.push(`${yamlString(k)}: ${yamlValue(v)}`);
  }
  lines.push("---", "");
  const trimmed = body.replace(/^\n+/, "").replace(/\s+$/, "");
  return `${lines.join("\n")}\n${trimmed}\n`;
}
