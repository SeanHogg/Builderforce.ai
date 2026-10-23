import { describe, expect, it } from "vitest";
import {
  formatSkillCatalog,
  isBinarySkillPath,
  isValidSkillName,
  normalizeSkillPath,
  skillFileByteLength,
  parseFrontmatter,
  readSkillMarkdown,
  readSkillPackage,
  splitAllowedTools,
  splitSkillMarkdown,
  toSkillName,
  TOOL_HOST_INSTRUCTIONS,
  validateSkillFrontmatter,
  writeSkillPackage,
} from "./index.js";

const SKILL = `---
name: pdf-processing
description: Extract text and tables from PDF files, fill forms, merge documents. Use when working with PDFs.
license: Apache-2.0
compatibility: Requires python3 and pdfplumber
metadata:
  author: example-org
  version: "1.0"
allowed-tools: Bash(git:*) Bash(jq:*) Read
---

# PDF processing

Run scripts/extract.py on the file.
`;

describe("spec name rule", () => {
  it.each([
    ["pdf-processing", true],
    ["a", true],
    ["data-analysis-2", true],
    ["PDF-Processing", false],
    ["-pdf", false],
    ["pdf-", false],
    ["pdf--processing", false],
    ["pdf_processing", false],
    ["a".repeat(65), false],
  ])("%s → %s", (name, ok) => {
    expect(isValidSkillName(name)).toBe(ok);
  });

  it("coerces free text into a valid name", () => {
    expect(toSkillName("Add a Schema Column — end to end!")).toBe("add-a-schema-column-end-to-end");
    expect(toSkillName("hello_world")).toBe("hello-world");
    const long = toSkillName("word ".repeat(40));
    expect(isValidSkillName(long)).toBe(true);
    expect(toSkillName("!!!")).toBe("");
  });
});

describe("frontmatter", () => {
  it("splits and parses the spec example", () => {
    const split = splitSkillMarkdown(SKILL);
    expect(split.body.startsWith("# PDF processing")).toBe(true);
    const fm = parseFrontmatter(split.frontmatter!);
    expect(fm.name).toBe("pdf-processing");
    expect(fm.metadata).toEqual({ author: "example-org", version: "1.0" });
    expect(fm["allowed-tools"]).toBe("Bash(git:*) Bash(jq:*) Read");
  });

  it("reads block scalars, booleans, lists and multi-line flow JSON", () => {
    const fm = parseFrontmatter([
      "description: >",
      "  Folded onto",
      "  one line.",
      "notes: |",
      "  line one",
      "  line two",
      "disable-model-invocation: true",
      "tags:",
      "  - a",
      "  - 'b'",
      'metadata: { "builderforce": {',
      '    "requires": { "bins": ["gh"] },',
      "  }",
      "}",
    ].join("\n"));
    expect(fm.description).toBe("Folded onto one line.\n");
    expect(fm.notes).toBe("line one\nline two\n");
    expect(fm["disable-model-invocation"]).toBe(true);
    expect(fm.tags).toEqual(["a", "b"]);
    expect(fm.metadata).toEqual({ builderforce: { requires: { bins: ["gh"] } } });
  });

  it("keeps a version string a string", () => {
    expect(parseFrontmatter("version: 1.0").version).toBe("1.0");
  });

  it("uses an injected parser when given one", () => {
    expect(parseFrontmatter("x", () => ({ name: "from-host" }))).toEqual({ name: "from-host" });
  });

  it("returns no frontmatter when the fence is absent or unclosed", () => {
    expect(splitSkillMarkdown("# just markdown").frontmatter).toBeNull();
    expect(splitSkillMarkdown("---\nname: x\n").frontmatter).toBeNull();
  });
});

describe("validation", () => {
  it("normalises the optional fields", () => {
    const v = validateSkillFrontmatter(parseFrontmatter(splitSkillMarkdown(SKILL).frontmatter!), { directoryName: "pdf-processing" });
    expect(v.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(v.manifest?.allowedTools).toEqual(["Bash(git:*)", "Bash(jq:*)", "Read"]);
    expect(v.manifest?.license).toBe("Apache-2.0");
  });

  it("rejects a name that does not match its folder", () => {
    const v = validateSkillFrontmatter({ name: "hello_world", description: "Says hello." }, { directoryName: "hello-world" });
    expect(v.manifest).toBeNull();
    expect(v.issues.map((i) => i.code)).toEqual(expect.arrayContaining(["name_format", "name_directory_mismatch"]));
  });

  it("requires a description", () => {
    expect(validateSkillFrontmatter({ name: "x" }).issues.map((i) => i.code)).toContain("description_missing");
  });

  it("enforces the length limits", () => {
    const codes = validateSkillFrontmatter({ name: "x", description: "d".repeat(1025), compatibility: "c".repeat(501) }).issues.map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["description_too_long", "compatibility_too_long"]));
  });

  it("preserves non-spec keys as extensions", () => {
    const v = validateSkillFrontmatter({ name: "x", description: "d", "user-invocable": false });
    expect(v.manifest?.extensions).toEqual({ "user-invocable": false });
  });

  it("splits allowed-tools outside parentheses", () => {
    expect(splitAllowedTools("Bash(git add:*) Read  Write")).toEqual(["Bash(git add:*)", "Read", "Write"]);
  });
});

describe("skill folders", () => {
  it("reads a zipped folder and strips its top directory", () => {
    const r = readSkillPackage([
      { path: "pdf-processing/SKILL.md", content: SKILL },
      { path: "pdf-processing/scripts/extract.py", content: "print('hi')" },
      { path: "pdf-processing/.DS_Store", content: "x" },
    ]);
    expect(r.package?.manifest.name).toBe("pdf-processing");
    expect(r.package?.files.map((f) => f.path)).toEqual(["scripts/extract.py"]);
    expect(r.issues.some((i) => i.code === "path_skipped")).toBe(true);
  });

  it("refuses a folder whose name disagrees with the skill", () => {
    const r = readSkillPackage([{ path: "other/SKILL.md", content: SKILL }]);
    expect(r.package).toBeNull();
    expect(r.issues.map((i) => i.code)).toContain("name_directory_mismatch");
  });

  it("refuses unsafe paths and oversize folders", () => {
    expect(normalizeSkillPath("../etc/passwd")).toBeNull();
    expect(normalizeSkillPath("/abs")).toBeNull();
    expect(normalizeSkillPath("C:/x")).toBeNull();
    expect(normalizeSkillPath("scripts\\run.sh")).toBe("scripts/run.sh");
    const big = readSkillPackage([{ path: "SKILL.md", content: SKILL }, { path: "a.txt", content: "x".repeat(300 * 1024) }]);
    expect(big.issues.map((i) => i.code)).toContain("file_too_large");
  });

  it("reports a missing or ambiguous SKILL.md", () => {
    expect(readSkillPackage([{ path: "README.md", content: "x" }]).issues[0]?.code).toBe("skill_md_missing");
    expect(readSkillPackage([{ path: "a/SKILL.md", content: SKILL }, { path: "b/SKILL.md", content: SKILL }]).issues[0]?.code).toBe("skill_md_ambiguous");
  });

  it("skips a binary bundled file and refuses a binary SKILL.md", () => {
    const withImage = readSkillPackage([{ path: "SKILL.md", content: SKILL }, { path: "assets/logo.png", content: "PNG\u0000\u0001" }]);
    expect(withImage.package?.files.map((f) => f.path)).not.toContain("assets/logo.png");
    expect(withImage.issues.find((i) => i.code === "binary_file")?.severity).toBe("warning");
    const binarySkill = readSkillPackage([{ path: "SKILL.md", content: `${SKILL}\u0000` }]);
    expect(binarySkill.package).toBeNull();
    expect(binarySkill.issues.at(-1)?.code).toBe("binary_file");
  });

  it("keeps a base64 binary asset, measures it decoded, and round-trips its encoding", () => {
    const png = { path: "assets/logo.png", content: "iVBORw0KGgo=", encoding: "base64" as const };
    const read = readSkillPackage([{ path: "SKILL.md", content: SKILL }, png]);
    expect(read.package?.files).toEqual([png]);
    expect(skillFileByteLength(png)).toBe(8);
    expect(writeSkillPackage(read.package!).at(-1)).toEqual(png);
    const bad = readSkillPackage([{ path: "SKILL.md", content: SKILL }, { ...png, content: "not base64!" }]);
    expect(bad.issues.find((i) => i.code === "binary_invalid")?.severity).toBe("warning");
    const tooBig = readSkillPackage([{ path: "SKILL.md", content: SKILL }, png], { limits: { maxBinaryFileBytes: 4 } });
    expect(tooBig.issues.at(-1)?.code).toBe("file_too_large");
    expect(readSkillPackage([{ path: "SKILL.md", content: "eA==", encoding: "base64" }]).issues.at(-1)?.code).toBe("binary_file");
    expect(isBinarySkillPath("assets/Logo.PNG")).toBe(true);
    expect(isBinarySkillPath("scripts/run.sh")).toBe(false);
    expect(isBinarySkillPath("png")).toBe(false);
  });

  it("round-trips through writeSkillPackage", () => {
    const first = readSkillMarkdown(SKILL).package!;
    const written = writeSkillPackage({ ...first, files: [{ path: "references/REFERENCE.md", content: "ref" }] }, { folder: true });
    expect(written[0]?.path).toBe("pdf-processing/SKILL.md");
    const again = readSkillPackage(written).package!;
    expect(again.manifest).toEqual(first.manifest);
    expect(again.body.trim()).toBe(first.body.trim());
    expect(again.files).toEqual([{ path: "references/REFERENCE.md", content: "ref" }]);
  });
});

describe("catalog", () => {
  it("renders nothing for no skills and escapes XML", () => {
    expect(formatSkillCatalog([], TOOL_HOST_INSTRUCTIONS)).toBe("");
    const block = formatSkillCatalog([{ name: "a", description: "Use <when> & why" }], TOOL_HOST_INSTRUCTIONS);
    expect(block).toContain("<available_skills>");
    expect(block).toContain("Use &lt;when&gt; &amp; why");
    expect(block).not.toContain("<location>");
  });
});
