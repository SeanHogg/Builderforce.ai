import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeAssignedArtifactSlugs } from "../assigned-artifacts-sidecar.js";
import { filterSyncedSkillsForRun, syncAssignedSkills } from "./assigned-sync.js";

const SKILL_MD = "---\nname: ship-it\ndescription: Use when shipping.\n---\n\n1. Run scripts/ship.sh.\n";

type FakeFile = { path: string; content: string; encoding?: "base64" };

/**
 * A fake gateway: `listing` is the host skill listing (`null` ⇒ the listing call fails),
 * `packages` the folders it serves. Records every package fetch in `calls`.
 */
function fakeGateway(
  listing: Array<{ name: string; updatedAt: string }> | null,
  packages: Record<string, { status?: number; files?: FakeFile[] }>,
) {
  const calls: string[] = [];
  const fetchImpl = (async (url: string) => {
    const route = String(url).replace("https://gw.test", "");
    if (route === "/llm/v1/skills/host") {
      return listing ? new Response(JSON.stringify({ skills: listing })) : new Response("down", { status: 503 });
    }
    const name = decodeURIComponent(route.split("/skills/")[1]!.split("/")[0]!);
    calls.push(name);
    const hit = packages[name];
    return new Response(JSON.stringify({ files: hit?.files ?? [] }), { status: hit?.status ?? (hit ? 200 : 404) });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe("syncAssignedSkills", () => {
  let dir: string;
  let arts: string;
  const gateway = { base: "https://gw.test", apiKey: "k" };
  const shipIt = { files: [{ path: "SKILL.md", content: SKILL_MD }, { path: "scripts/ship.sh", content: "echo ship" }] };
  const md = (name: string) => ({ files: [{ path: "SKILL.md", content: SKILL_MD.replace("ship-it", name) }] });
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-skills-"));
    arts = fs.mkdtempSync(path.join(os.tmpdir(), "bf-arts-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(arts, { recursive: true, force: true });
  });

  it("writes every host-assigned skill as a spec folder the loader can discover", async () => {
    const { fetchImpl } = fakeGateway([{ name: "ship-it", updatedAt: "v1" }], { "ship-it": shipIt });
    const r = await syncAssignedSkills({ managedSkillsDir: dir, runArtifactsDir: arts, gateway, fetchImpl });
    expect(r.written).toEqual(["ship-it"]);
    expect(fs.readFileSync(path.join(dir, "ship-it", "SKILL.md"), "utf-8")).toContain("name: ship-it");
    expect(fs.readFileSync(path.join(dir, "ship-it", "scripts", "ship.sh"), "utf-8")).toBe("echo ship");
  });

  it("writes a base64 asset as its original bytes", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]);
    const { fetchImpl } = fakeGateway([{ name: "ship-it", updatedAt: "v1" }], {
      "ship-it": { files: [{ path: "SKILL.md", content: SKILL_MD }, { path: "assets/logo.png", content: png.toString("base64"), encoding: "base64" }] },
    });
    await syncAssignedSkills({ managedSkillsDir: dir, runArtifactsDir: arts, gateway, fetchImpl });
    expect(fs.readFileSync(path.join(dir, "ship-it", "assets", "logo.png")).equals(png)).toBe(true);
  });

  it("re-fetches only what changed since the last sync", async () => {
    const first = fakeGateway([{ name: "ship-it", updatedAt: "v1" }], { "ship-it": shipIt });
    await syncAssignedSkills({ managedSkillsDir: dir, runArtifactsDir: arts, gateway, fetchImpl: first.fetchImpl });
    const same = fakeGateway([{ name: "ship-it", updatedAt: "v1" }], { "ship-it": shipIt });
    const r = await syncAssignedSkills({ managedSkillsDir: dir, runArtifactsDir: arts, gateway, fetchImpl: same.fetchImpl });
    expect(r.unchanged).toEqual(["ship-it"]);
    expect(same.calls).toEqual([]);
    const changed = fakeGateway([{ name: "ship-it", updatedAt: "v2" }], { "ship-it": shipIt });
    const again = await syncAssignedSkills({ managedSkillsDir: dir, runArtifactsDir: arts, gateway, fetchImpl: changed.fetchImpl });
    expect(again.written).toEqual(["ship-it"]);
    expect(changed.calls).toEqual(["ship-it"]);
  });

  it("never writes outside the skill folder", async () => {
    const { fetchImpl } = fakeGateway([{ name: "ship-it", updatedAt: "v1" }], {
      "ship-it": { files: [{ path: "SKILL.md", content: SKILL_MD }, { path: "../escape.sh", content: "x" }] },
    });
    await syncAssignedSkills({ managedSkillsDir: dir, runArtifactsDir: arts, gateway, fetchImpl });
    expect(fs.existsSync(path.join(dir, "escape.sh"))).toBe(false);
  });

  it("leaves a user's own same-named skill alone", async () => {
    fs.mkdirSync(path.join(dir, "ship-it"));
    fs.writeFileSync(path.join(dir, "ship-it", "SKILL.md"), "mine");
    const { fetchImpl } = fakeGateway([{ name: "ship-it", updatedAt: "v1" }], { "ship-it": shipIt });
    const r = await syncAssignedSkills({ managedSkillsDir: dir, runArtifactsDir: arts, gateway, fetchImpl });
    expect(r.written).toEqual([]);
    expect(r.skipped[0]?.reason).toContain("already exists");
    expect(fs.readFileSync(path.join(dir, "ship-it", "SKILL.md"), "utf-8")).toBe("mine");
  });

  it("reports a listed skill the gateway does not serve", async () => {
    const { fetchImpl } = fakeGateway([{ name: "nope", updatedAt: "v1" }], {});
    const r = await syncAssignedSkills({ managedSkillsDir: dir, runArtifactsDir: arts, gateway, fetchImpl });
    expect(r.skipped).toEqual([{ slug: "nope", reason: "gateway returned 404" }]);
  });

  it("removes a synced skill as soon as the host is unassigned it, but never a user's own folder", async () => {
    await syncAssignedSkills({ managedSkillsDir: dir, runArtifactsDir: arts, gateway, fetchImpl: fakeGateway([{ name: "ship-it", updatedAt: "v1" }], { "ship-it": shipIt }).fetchImpl });
    fs.mkdirSync(path.join(dir, "mine"));
    fs.writeFileSync(path.join(dir, "mine", "SKILL.md"), "mine");
    const r = await syncAssignedSkills({ managedSkillsDir: dir, runArtifactsDir: arts, gateway, fetchImpl: fakeGateway([], {}).fetchImpl });
    expect(r.removed).toEqual(["ship-it"]);
    expect(fs.existsSync(path.join(dir, "ship-it"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "mine", "SKILL.md"))).toBe(true);
  });

  it("removes nothing when the host listing cannot be read", async () => {
    await syncAssignedSkills({ managedSkillsDir: dir, runArtifactsDir: arts, gateway, fetchImpl: fakeGateway([{ name: "ship-it", updatedAt: "v1" }], { "ship-it": shipIt }).fetchImpl });
    const r = await syncAssignedSkills({ managedSkillsDir: dir, runArtifactsDir: arts, gateway, fetchImpl: fakeGateway(null, {}).fetchImpl });
    expect(r.removed).toEqual([]);
    expect(r.skipped[0]?.reason).toContain("host skill listing unavailable");
    expect(fs.existsSync(path.join(dir, "ship-it", "SKILL.md"))).toBe(true);
  });

  it("keeps the last good copy of a still-listed skill the gateway cannot serve", async () => {
    await syncAssignedSkills({ managedSkillsDir: dir, runArtifactsDir: arts, gateway, fetchImpl: fakeGateway([{ name: "ship-it", updatedAt: "v1" }], { "ship-it": shipIt }).fetchImpl });
    const r = await syncAssignedSkills({
      managedSkillsDir: dir,
      runArtifactsDir: arts,
      gateway,
      fetchImpl: fakeGateway([{ name: "ship-it", updatedAt: "v2" }], { "ship-it": { status: 503 } }).fetchImpl,
    });
    expect(r.removed).toEqual([]);
    expect(fs.existsSync(path.join(dir, "ship-it", "SKILL.md"))).toBe(true);
  });

  it("fetches a task-scoped run skill the host listing lacks, and re-fetches it on every run", async () => {
    const first = fakeGateway([], { "task-only": md("task-only") });
    const r = await syncAssignedSkills({ managedSkillsDir: dir, runArtifactsDir: arts, gateway, fetchImpl: first.fetchImpl, runSkills: ["task-only"] });
    expect(r.written).toEqual(["task-only"]);
    expect(r.removed).toEqual([]);
    expect(fs.existsSync(path.join(dir, "task-only", "SKILL.md"))).toBe(true);
    const again = fakeGateway([], { "task-only": md("task-only") });
    await syncAssignedSkills({ managedSkillsDir: dir, runArtifactsDir: arts, gateway, fetchImpl: again.fetchImpl, runSkills: ["task-only"] });
    expect(again.calls).toEqual(["task-only"]);
  });

  it("still fetches the run's own skills when the host listing is down, removing nothing", async () => {
    await syncAssignedSkills({ managedSkillsDir: dir, runArtifactsDir: arts, gateway, fetchImpl: fakeGateway([{ name: "ship-it", updatedAt: "v1" }], { "ship-it": shipIt }).fetchImpl });
    const r = await syncAssignedSkills({ managedSkillsDir: dir, runArtifactsDir: arts, gateway, fetchImpl: fakeGateway(null, { "task-only": md("task-only") }).fetchImpl, runSkills: ["task-only"] });
    expect(r.written).toEqual(["task-only"]);
    expect(r.removed).toEqual([]);
    expect(fs.existsSync(path.join(dir, "ship-it", "SKILL.md"))).toBe(true);
  });

  it("keeps a skill another LIVE run was assigned, and drops it once that run's workspace is gone", async () => {
    const otherWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "bf-ws-"));
    await writeAssignedArtifactSlugs(otherWorkspace, { skills: ["task-only"], personas: [], content: [] }, arts);
    await syncAssignedSkills({ managedSkillsDir: dir, runArtifactsDir: arts, gateway, fetchImpl: fakeGateway([], { "task-only": md("task-only") }).fetchImpl, runSkills: ["task-only"] });
    // A different run syncs with its own (empty) list while the other run is still in flight.
    const during = await syncAssignedSkills({ managedSkillsDir: dir, runArtifactsDir: arts, gateway, fetchImpl: fakeGateway([], {}).fetchImpl, runSkills: [] });
    expect(during.removed).toEqual([]);
    expect(fs.existsSync(path.join(dir, "task-only", "SKILL.md"))).toBe(true);
    // Its ticket finishes and the workspace is released: the next sync retires the skill.
    fs.rmSync(otherWorkspace, { recursive: true, force: true });
    const after = await syncAssignedSkills({ managedSkillsDir: dir, runArtifactsDir: arts, gateway, fetchImpl: fakeGateway([], {}).fetchImpl, runSkills: [] });
    expect(after.removed).toEqual(["task-only"]);
    expect(fs.readdirSync(arts)).toEqual([]);
  });
});

describe("filterSyncedSkillsForRun", () => {
  let dir: string;
  let arts: string;
  let wsA: string;
  let wsB: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-skills-"));
    arts = fs.mkdtempSync(path.join(os.tmpdir(), "bf-arts-"));
    wsA = fs.mkdtempSync(path.join(os.tmpdir(), "bf-ws-a-"));
    wsB = fs.mkdtempSync(path.join(os.tmpdir(), "bf-ws-b-"));
  });
  afterEach(() => {
    for (const d of [dir, arts, wsA, wsB]) fs.rmSync(d, { recursive: true, force: true });
  });

  async function syncTwo(): Promise<void> {
    const md = (name: string) => ({ files: [{ path: "SKILL.md", content: SKILL_MD.replace("ship-it", name) }] });
    await syncAssignedSkills({
      managedSkillsDir: dir,
      runArtifactsDir: arts,
      gateway: { base: "https://gw.test", apiKey: "k" },
      fetchImpl: fakeGateway([{ name: "ship-it", updatedAt: "v1" }, { name: "other-project", updatedAt: "v1" }], {
        "ship-it": md("ship-it"),
        "other-project": md("other-project"),
      }).fetchImpl,
    });
    fs.mkdirSync(path.join(dir, "mine"));
  }

  const skillsIn = (names: string[]) => names.map((name) => ({ name, baseDir: path.join(dir, name) }));

  it("keeps only the synced skills this run was assigned, and every unsynced skill", async () => {
    await syncTwo();
    await writeAssignedArtifactSlugs(wsA, { skills: ["ship-it"], personas: [], content: [] }, arts);
    const names = filterSyncedSkillsForRun(skillsIn(["ship-it", "other-project", "mine"]), wsA, arts).map((s) => s.name);
    expect(names).toEqual(["ship-it", "mine"]);
  });

  it("gives concurrent runs their own lists, and a run that never synced no synced skills", async () => {
    await syncTwo();
    await writeAssignedArtifactSlugs(wsA, { skills: ["ship-it"], personas: [], content: [] }, arts);
    await writeAssignedArtifactSlugs(wsB, { skills: ["other-project"], personas: [], content: [] }, arts);
    const all = skillsIn(["ship-it", "other-project", "mine"]);
    expect(filterSyncedSkillsForRun(all, wsA, arts).map((s) => s.name)).toEqual(["ship-it", "mine"]);
    expect(filterSyncedSkillsForRun(all, wsB, arts).map((s) => s.name)).toEqual(["other-project", "mine"]);
    const never = fs.mkdtempSync(path.join(os.tmpdir(), "bf-ws-c-"));
    try {
      expect(filterSyncedSkillsForRun(all, never, arts).map((s) => s.name)).toEqual(["mine"]);
    } finally {
      fs.rmSync(never, { recursive: true, force: true });
    }
  });
});
