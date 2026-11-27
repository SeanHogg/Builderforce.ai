import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({ l10n: { t: (s: string) => s } }));

import { skillsLabels } from "./skillsViewLabels";
import { renderSkillsHtml } from "./skillsViewHtml";
import { SKILLS_CLIENT_CORE } from "./skillsClientCore";
import { SKILLS_CLIENT_SKILLS } from "./skillsClientSkills";
import { SKILLS_CLIENT_TEACH } from "./skillsClientTeach";
import { SKILLS_CSS } from "./skillsViewStyles";

const script = [SKILLS_CLIENT_CORE, SKILLS_CLIENT_TEACH, SKILLS_CLIENT_SKILLS].join("\n");

describe("Skills page", () => {
  it("is syntactically valid script", () => {
    expect(() => new Function(script)).not.toThrow();
  });

  it("never builds markup from data", () => {
    expect(script).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  });

  it("is locked to a nonce'd CSP with no remote origin", () => {
    const html = renderSkillsHtml({ nonce: "abc123", title: "Skills <&>" });
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("script-src 'nonce-abc123'");
    expect(html).toContain("style-src 'nonce-abc123'");
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).toContain("<title>Skills &lt;&amp;&gt;</title>");
  });

  it("takes every colour from the editor theme, never a literal", () => {
    expect(SKILLS_CSS).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
    expect(SKILLS_CSS).toMatch(/var\(--vscode-/);
  });

  it("only reads labels the host sends", () => {
    const labels = skillsLabels();
    const used = new Set<string>();
    for (const m of script.matchAll(/\bL\.([A-Za-z]+)/g)) used.add(m[1]!);
    for (const m of script.matchAll(/fmt\('([A-Za-z]+)'/g)) used.add(m[1]!);
    const missing = [...used].filter((k) => !(k in labels));
    expect(missing).toEqual([]);
  });

  it("has a label for every run status and step outcome the page words dynamically", () => {
    const labels = skillsLabels();
    for (const s of ["Running", "Succeeded", "Failed", "Stopped", "Denied"]) expect(labels[`status${s}`]).toBeTruthy();
    for (const o of ["Ok", "Fallback", "Failed", "Approved", "Denied"]) expect(labels[`outcome${o}`]).toBeTruthy();
  });
});
