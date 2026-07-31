import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import {
  createCodeGapsTool,
  identifyGaps,
  checkSignatureExists,
  collectFileIndex,
  generateMarkdown,
  generateCSV,
  generateJSON,
  type PlannedItem,
} from "./code-gaps-tool.js";

function fakeApi(overrides: any = {}) {
  return {
    id: "code-gaps",
    name: "code-gaps",
    source: "test",
    config: {
      agents: { defaults: { workspace: "/tmp" } },
    },
    pluginConfig: {},
    runtime: { version: "test" },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    registerTool() {},
    ...overrides,
  };
}

// Helper to create a temp codebase on disk
function makeTempCodebase(files: Record<string, string>): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bf-gaps-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return tmp;
}

function cleanupTmp(tmp: string) {
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

describe("code-gaps tool — FR1/FR3/AC1 AC2", () => {
  it("AC1: item absent => reported as gap", async () => {
    const tmp = makeTempCodebase({
      "src/app.ts": "export const foo = 1;",
    });
    try {
      const items: PlannedItem[] = [
        { id: "feature-001", name: "Email Notifications", signature: "NotificationService.sendEmail" },
      ];
      const index = await collectFileIndex(tmp, []);
      const { gaps, found } = await identifyGaps(items, tmp, [], index);

      expect(gaps.length).toBe(1);
      expect(gaps[0].id).toBe("feature-001");
      expect(found.size).toBe(0);
    } finally {
      cleanupTmp(tmp);
    }
  });

  it("AC2: item present (literal) => NOT reported as gap", async () => {
    const tmp = makeTempCodebase({
      "src/notification.ts": "class NotificationService { sendEmail(to, body) {} }",
    });
    try {
      const items: PlannedItem[] = [
        { id: "feature-001", name: "Email Notifications", signature: "NotificationService.sendEmail" },
      ];
      const index = await collectFileIndex(tmp, []);
      const { gaps, found } = await identifyGaps(items, tmp, [], index);

      expect(gaps.length).toBe(0);
      expect(found.get("feature-001")).toBeTruthy();
    } finally {
      cleanupTmp(tmp);
    }
  });

  it("AC2: item present (regex) => NOT reported as gap", async () => {
    const tmp = makeTempCodebase({
      "src/routes.ts": "app.get('api/v1/user/123/avatar', handler)",
    });
    try {
      const items: PlannedItem[] = [
        { id: "feat-avatar", name: "Avatar Upload", signature: "api\\/v1\\/user\\/.*\\/avatar" },
      ];
      const index = await collectFileIndex(tmp, []);
      const { gaps } = await identifyGaps(items, tmp, [], index);

      expect(gaps.length).toBe(0);
    } finally {
      cleanupTmp(tmp);
    }
  });
});

describe("code-gaps tool — AC3 detailed reporting", () => {
  it("report includes id, name, signature, sourceDocument, priority for each gap", async () => {
    const tmp = makeTempCodebase({ "src/app.ts": "empty" });
    try {
      const items: PlannedItem[] = [
        {
          id: "feat-042",
          name: "User Profile Avatar Upload",
          signature: "class UserProfileAvatarService",
          sourceDocument: "DESIGNDOC-123",
          priority: "P1",
        },
      ];
      const index = await collectFileIndex(tmp, []);
      const { gaps } = await identifyGaps(items, tmp, [], index);

      expect(gaps[0].id).toBe("feat-042");
      expect(gaps[0].name).toBe("User Profile Avatar Upload");
      expect(gaps[0].signature).toBe("class UserProfileAvatarService");
      expect(gaps[0].sourceDocument).toBe("DESIGNDOC-123");
      expect(gaps[0].priority).toBe("P1");
    } finally {
      cleanupTmp(tmp);
    }
  });

  it("markdown output includes id, name, signature per gap (AC3/AC5)", () => {
    const report = {
      projectName: "test",
      scanDate: new Date().toISOString(),
      totalItems: 2,
      implemented: 1,
      gapsCount: 1,
      gaps: [
        {
          id: "feat-001",
          name: "Email Notifications",
          signature: "NotificationService.sendEmail",
          sourceDocument: "TICKET-1",
          priority: "P0",
        },
      ],
    };
    const md = generateMarkdown(report);
    expect(md).toContain("feat-001");
    expect(md).toContain("Email Notifications");
    expect(md).toContain("NotificationService.sendEmail");
    expect(md).toContain("TICKET-1");
    expect(md).toContain("P0");
  });

  it("json output is parseable and contains all fields (FR5)", () => {
    const report = {
      projectName: "test",
      scanDate: new Date().toISOString(),
      totalItems: 1,
      implemented: 0,
      gapsCount: 1,
      gaps: [
        { id: "f1", name: "Foo", signature: "class Foo", priority: "P2" },
      ],
    };
    const json = generateJSON(report);
    const parsed = JSON.parse(json);
    expect(parsed.gaps[0].id).toBe("f1");
    expect(parsed.gaps[0].signature).toBe("class Foo");
  });

  it("csv output contains all required columns (FR5)", () => {
    const report = {
      projectName: "test",
      scanDate: new Date().toISOString(),
      totalItems: 1,
      implemented: 0,
      gapsCount: 1,
      gaps: [
        { id: "f1", name: "Foo", signature: "class Foo", priority: "P2", sourceDocument: "DOC-1" },
      ],
    };
    const csv = generateCSV(report);
    expect(csv).toContain("ID,Name,Signature,Priority,Source Document");
    expect(csv).toContain("f1");
    expect(csv).toContain("Foo");
    expect(csv).toContain("class Foo");
  });
});

describe("code-gaps tool — FR2 codebase scanning", () => {
  it("file-pattern signature: existing file removes gap", async () => {
    const tmp = makeTempCodebase({
      "api/v1/user/avatar.ts": "export const handler = () => {}",
    });
    try {
      const index = await collectFileIndex(tmp, []);
      const match = await checkSignatureExists("api/v1/user/avatar.ts", tmp, index, []);
      expect(match).toBeTruthy();
    } finally {
      cleanupTmp(tmp);
    }
  });

  it("file-pattern signature: non-existing file is gap", async () => {
    const tmp = makeTempCodebase({ "src/app.ts": "foo" });
    try {
      const index = await collectFileIndex(tmp, []);
      const match = await checkSignatureExists("api/v1/user/avatar.ts", tmp, index, []);
      expect(match).toBeNull();
    } finally {
      cleanupTmp(tmp);
    }
  });

  it("no false positives: different class with similar name should not match", async () => {
    const tmp = makeTempCodebase({
      "src/service.ts": "class UserService {}",
    });
    try {
      const items: PlannedItem[] = [
        { id: "f-avatar", name: "Avatar", signature: "class UserProfileAvatarService" },
      ];
      const index = await collectFileIndex(tmp, []);
      const { gaps } = await identifyGaps(items, tmp, [], index);
      expect(gaps.length).toBe(1);
    } finally {
      cleanupTmp(tmp);
    }
  });

  it("handles 100 items within perf budget (AC4 smoke)", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 20; i++) {
      files[`src/mod${i}.ts`] = `class Mod${i}Service { run(){} }`;
    }
    const tmp = makeTempCodebase(files);
    try {
      const items: PlannedItem[] = [];
      for (let i = 0; i < 100; i++) {
        items.push({
          id: `feat-${String(i).padStart(3, "0")}`,
          name: `Feature ${i}`,
          signature: i < 20 ? `class Mod${i}Service` : `class Missing${i}Service`,
        });
      }
      const index = await collectFileIndex(tmp, []);
      const start = Date.now();
      const { gaps, found } = await identifyGaps(items, tmp, [], index);
      const elapsed = Date.now() - start;

      expect(found.size).toBe(20);
      expect(gaps.length).toBe(80);
      expect(elapsed).toBeLessThan(5000); // <5 sec AC4
    } finally {
      cleanupTmp(tmp);
    }
  });

  it("excludes patterns from scan", async () => {
    const tmp = makeTempCodebase({
      "node_modules/foo/index.ts": "class SecretService {}",
      "src/app.ts": "empty",
    });
    try {
      const items: PlannedItem[] = [
        { id: "f1", name: "Secret", signature: "class SecretService" },
      ];
      const index = await collectFileIndex(tmp, ["**/node_modules/**"]);
      const { gaps } = await identifyGaps(items, tmp, ["**/node_modules/**"], index);
      // SecretService only in node_modules which is excluded, so should be gap
      expect(gaps.length).toBe(1);
    } finally {
      cleanupTmp(tmp);
    }
  });

  it("special regex chars handled safely (no injection)", async () => {
    const tmp = makeTempCodebase({
      "src/app.ts": "const x = 1",
    });
    try {
      const items: PlannedItem[] = [
        { id: "inj", name: "Injection Attempt", signature: "`; rm -rf /; echo `" },
      ];
      // Should not throw, should not execute
      const index = await collectFileIndex(tmp, []);
      const { gaps } = await identifyGaps(items, tmp, [], index);
      expect(gaps.length).toBe(1); // signature not found
    } finally {
      cleanupTmp(tmp);
    }
  });

  it("empty signature is always gap", async () => {
    const tmp = makeTempCodebase({ "src/app.ts": "foo bar" });
    try {
      const index = await collectFileIndex(tmp, []);
      const match = await checkSignatureExists("", tmp, index, []);
      expect(match).toBeNull();
    } finally {
      cleanupTmp(tmp);
    }
  });
});

describe("code-gaps tool — execute (end-to-end)", () => {
  it("execute returns markdown by default", async () => {
    const tmp = makeTempCodebase({ "src/app.ts": "empty" });
    try {
      const tool = createCodeGapsTool(fakeApi());
      const res = await tool.execute("id", {
        items: [
          { id: "f1", name: "Missing", signature: "class MissingClass" },
        ],
        rootPath: tmp,
      });
      const text = (res as any).content[0].text as string;
      expect(text).toContain("Code Gap Analysis");
      expect(text).toContain("Missing");
      expect((res as any).details.gapsCount).toBe(1);
    } finally {
      cleanupTmp(tmp);
    }
  });

  it("execute supports json format", async () => {
    const tmp = makeTempCodebase({ "src/app.ts": "class ExistingService {}" });
    try {
      const tool = createCodeGapsTool(fakeApi());
      const res = await tool.execute("id", {
        items: [
          { id: "f1", name: "Exists", signature: "class ExistingService" },
          { id: "f2", name: "Missing", signature: "class Missing" },
        ],
        rootPath: tmp,
        outputFormat: "json",
      });
      const text = (res as any).content[0].text as string;
      const parsed = JSON.parse(text);
      expect(parsed.gapsCount).toBe(1);
      expect(parsed.gaps[0].id).toBe("f2");
    } finally {
      cleanupTmp(tmp);
    }
  });

  it("execute supports csv format", async () => {
    const tmp = makeTempCodebase({ "src/app.ts": "empty" });
    try {
      const tool = createCodeGapsTool(fakeApi());
      const res = await tool.execute("id", {
        items: [{ id: "f1", name: "Missing", signature: "doesnotexist" }],
        rootPath: tmp,
        outputFormat: "csv",
      });
      const text = (res as any).content[0].text as string;
      expect(text).toContain("Project");
      expect(text).toContain("f1");
    } finally {
      cleanupTmp(tmp);
    }
  });

  it("execute handles empty items list (no gaps)", async () => {
    const tmp = makeTempCodebase({ "src/app.ts": "foo" });
    try {
      const tool = createCodeGapsTool(fakeApi());
      const res = await tool.execute("id", { items: [], rootPath: tmp });
      expect((res as any).details.gapsCount).toBe(0);
      const text = (res as any).content[0].text as string;
      expect(text).toContain("No Gaps Found");
    } finally {
      cleanupTmp(tmp);
    }
  });
});
