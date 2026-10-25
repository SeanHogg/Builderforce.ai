import { existsSync, readFileSync } from "node:fs";
import { appendFile, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getLocalAuditRun, startLocalAuditRun } from "./localAuditStore";
import { decodeJournalFrames } from "@builderforce/local-first";
import { createVsCodeLocalFirstStore, localBrainApplication } from "./localFirstStore";
import { createLocalWorkRepository } from "./localWorkRepository";
import { changeSetLifecycleId, readChangeSetLifecycle, recordChangeSetBaseline } from "./changeSetLifecycle";
import { recordRunStarted } from "./runRecovery";
import { LOCAL_PERSISTENCE_METHODS } from "./bridgeProtocol";
import { callLocalPersistence } from "./localPersistenceDispatch";

vi.mock("vscode", () => ({
  l10n: { t: (message: string) => message },
  // runChangeSets imports gitChanges, which constructs this at load. The baseline
  // writer under test does not call git or the network.
  EventEmitter: class {
    event = () => ({ dispose() {} });
    fire(): void {}
    dispose(): void {}
  },
}));

type Host = Parameters<typeof localBrainApplication>[0];

function host(directory: string, state: Map<string, unknown>): Host {
  return {
    globalStorageUri: { fsPath: directory },
    globalState: {
      get: <T>(key: string) => state.get(key) as T | undefined,
      update: async (key: string, value: unknown) => {
        state.set(key, value);
      },
    },
    subscriptions: [],
  } as unknown as Host;
}

function framesOf(path: string) {
  return decodeJournalFrames(new Uint8Array(readFileSync(path)));
}

describe("local-first journal transaction", () => {
  const directories: string[] = [];
  const fetchSpy = vi.fn(() => Promise.reject(new Error("network")));

  afterEach(async () => {
    vi.unstubAllGlobals();
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  async function directory(): Promise<string> {
    const created = await mkdtemp(nodePath.join(tmpdir(), "bf-local-first-"));
    directories.push(created);
    return created;
  }

  it("acks a chat and its sync event in one journal frame, then reads them back without the snapshot or the network", async () => {
    vi.stubGlobal("fetch", fetchSpy);
    const root = await directory();
    const state = new Map<string, unknown>();
    const writing = localBrainApplication(host(root, state));
    expect(nodePath.basename(writing.durableStore.snapshotFile)).toBe("local-first-v1.json");
    expect(nodePath.basename(writing.durableStore.journalFile)).toBe("local-first-v2.journal");

    let sawRecordAndEvent = false;
    let snapshotAtAck = true;
    const stop = writing.store.subscribe(() => {
      const last = framesOf(writing.durableStore.journalFile).at(-1);
      sawRecordAndEvent = Boolean(
        last?.records.some((record) => record.entityType === "chat")
        && last?.events.some((event) => event.entityType === "chat" && last.records.some((record) => record.entityType === "chat" && record.id === event.clientEntityId)),
      );
      snapshotAtAck = existsSync(writing.durableStore.snapshotFile);
    });
    const chat = await writing.persistence.createChat({ title: "Offline chat" });
    stop();
    expect(sawRecordAndEvent).toBe(true);
    expect(snapshotAtAck).toBe(false);
    expect(state.get("builderforce.localDeviceId")).toEqual(expect.any(String));

    const created = framesOf(writing.durableStore.journalFile);
    const chatRecord = created[0]?.records.find((record) => record.entityType === "chat" && (record.payload as { chat?: { id?: number } }).chat?.id === chat.id);
    expect(chatRecord).toBeDefined();
    expect(created[0]?.events.some((event) => event.entityType === "chat" && event.clientEntityId === chatRecord?.id)).toBe(true);

    await writing.persistence.sendMessages(chat.id, [{ role: "user", content: "saved offline" }]);
    const committed = framesOf(writing.durableStore.journalFile).at(-1);
    const messageIds = new Set(
      committed?.records.filter((record) => record.entityType === "message").map((record) => record.id) ?? [],
    );
    expect(messageIds.size).toBeGreaterThan(0);
    expect(committed?.events.some((event) => event.entityType === "message" && messageIds.has(event.clientEntityId))).toBe(true);

    await writing.durableStore.flush();
    await rm(writing.durableStore.snapshotFile, { force: true });
    expect(existsSync(writing.durableStore.snapshotFile)).toBe(false);

    const restarted = localBrainApplication(host(root, state));
    expect((await restarted.persistence.getChat(chat.id))?.title).toBe("Offline chat");
    expect((await restarted.persistence.getMessages(chat.id)).map((message) => message.content)).toEqual(["saved offline"]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("serves every method the webview proxies through local.persistence, so the panel's first listChats is answered", async () => {
    const root = await directory();
    const app = localBrainApplication(host(root, new Map()));
    // 2026.10.57 opened on `s[i.method] is not a function`: the host object was a
    // write-only twin with no listChats. Every proxied name must be a real method.
    for (const method of LOCAL_PERSISTENCE_METHODS) {
      expect(typeof (app.persistence as unknown as Record<string, unknown>)[method], method).toBe("function");
    }
    const chat = await app.persistence.createChat({ title: "listed", projectId: 11 });
    const answer = await callLocalPersistence(app.persistence, "listChats", [{ projectId: "11" }]);
    expect(answer).toEqual({ ok: true, result: [expect.objectContaining({ id: chat.id, title: "listed" })] });
    const summarized = await callLocalPersistence(app.persistence, "summarizeChat", [chat.id]);
    // A local chat summarizes through the gateway now (Consolidate / Fork); an empty chat
    // has nothing to consolidate, which reads as an empty summary, never an error.
    expect(summarized).toEqual({ ok: true, result: { summary: "" } });
    await expect(app.persistence.getChat(chat.id + 999)).rejects.toThrow();
  });

  it("acks a project and a ticket in journal frames, then reads them back without the snapshot or the network", async () => {
    vi.stubGlobal("fetch", fetchSpy);
    const root = await directory();
    const state = new Map<string, unknown>([["builderforce.localDeviceId", "device-1"]]);
    const writing = createVsCodeLocalFirstStore(host(root, state));
    // Package index does not export UNBOUND_DESTINATION, so the omitted-destination
    // constructor throws. An explicit bound snapshot is the path this file can drive.
    const destination = { kind: "bound" as const, accountId: "acct-1", tenantId: "tenant-a" };
    const work = createLocalWorkRepository({ store: writing, deviceId: "device-1", destination });

    let sawProjectFrame = false;
    let snapshotAtProjectAck = true;
    const stop = writing.subscribe(() => {
      const last = framesOf(writing.journalFile).at(-1);
      const projectRecord = last?.records.find((record) => record.entityType === "project");
      sawProjectFrame = Boolean(
        projectRecord
        && last?.events.some((event) => event.entityType === "project" && event.clientEntityId === projectRecord.id),
      );
      snapshotAtProjectAck = existsSync(writing.snapshotFile);
    });
    const project = await work.createProject({ name: "Offline project", key: "OFF" });
    stop();
    expect(sawProjectFrame).toBe(true);
    expect(snapshotAtProjectAck).toBe(false);

    const projectFrame = framesOf(writing.journalFile).at(-1);
    expect(projectFrame?.records.some((record) => record.entityType === "project" && record.id === project.id)).toBe(true);
    expect(projectFrame?.events.some((event) => event.entityType === "project" && event.clientEntityId === project.id && event.operation === "create")).toBe(true);

    let sawTicketFrame = false;
    const stopTicket = writing.subscribe(() => {
      const last = framesOf(writing.journalFile).at(-1);
      const ticketRecord = last?.records.find((record) => record.entityType === "ticket");
      sawTicketFrame = Boolean(
        ticketRecord
        && last?.events.some((event) => event.entityType === "ticket" && event.clientEntityId === ticketRecord.id)
        && last?.records.some((record) => record.entityType === "project" && record.id === project.id),
      );
    });
    const ticket = await work.createTicket({
      projectId: project.id,
      title: "Offline ticket",
      description: "saved locally",
    });
    stopTicket();
    expect(sawTicketFrame).toBe(true);

    const ticketFrame = framesOf(writing.journalFile).at(-1);
    expect(ticketFrame?.records.some((record) => record.entityType === "ticket" && record.id === ticket.id)).toBe(true);
    expect(ticketFrame?.events.some((event) => event.entityType === "ticket" && event.clientEntityId === ticket.id && event.operation === "create")).toBe(true);

    await writing.flush();
    await rm(writing.snapshotFile, { force: true });
    expect(existsSync(writing.snapshotFile)).toBe(false);

    const restarted = createVsCodeLocalFirstStore(host(root, state));
    const again = createLocalWorkRepository({ store: restarted, deviceId: "device-1", destination });
    expect((await again.getProject(project.id)).payload).toMatchObject({ name: "Offline project", key: "OFF" });
    expect((await again.getTicket(ticket.id)).payload).toMatchObject({
      projectId: project.id,
      title: "Offline ticket",
      description: "saved locally",
      status: "backlog",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("acks an audit-run and an execution in BFJF1 frames, then reads them back without the snapshot or the network", async () => {
    vi.stubGlobal("fetch", fetchSpy);
    const root = await directory();
    const state = new Map<string, unknown>([["builderforce.localDeviceId", "device-1"]]);
    const writing = createVsCodeLocalFirstStore(host(root, state));
    // Same bound snapshot the project test passes. These writers default to unbound
    // when destination is omitted; this file does not import UNBOUND_DESTINATION.
    const destination = { kind: "bound" as const, accountId: "acct-1", tenantId: "tenant-a" };
    const now = new Date("2026-10-19T12:00:00.000Z");
    const deps = { deviceId: "device-1", now: () => now };
    const auditRunId = "audit-offline-1";
    const executionId = "exec-offline-1";
    const changeSetId = changeSetLifecycleId(executionId);

    const ackedBeforeSnapshot = (entityType: "audit-run" | "execution" | "change-set", id: string) => {
      const magic = readFileSync(writing.journalFile).subarray(0, 5).toString("utf8");
      const last = framesOf(writing.journalFile).at(-1);
      const record = last?.records.find((item) => item.entityType === entityType && item.id === id);
      return {
        frame: magic === "BFJF1" && Boolean(
          record
          && last?.events.some((event) => event.entityType === entityType && event.clientEntityId === record.id && event.operation === "create"),
        ),
        snapshot: existsSync(writing.snapshotFile),
      };
    };

    let auditAck = { frame: false, snapshot: true };
    const stopAudit = writing.subscribe(() => {
      auditAck = ackedBeforeSnapshot("audit-run", auditRunId);
    });
    const started = await startLocalAuditRun(writing, deps, {
      auditId: "quality-audit",
      projectId: 11,
      trigger: "manual",
      runId: auditRunId,
      source: { surface: "test" },
    });
    stopAudit();
    expect(started.runId).toBe(auditRunId);
    expect(auditAck).toEqual({ frame: true, snapshot: false });

    // Republish writes the cache after the listener. Drop it so the next commit
    // is also observed before local-first-v1.json exists. The journal frame stays.
    await writing.flush();
    await rm(writing.snapshotFile, { force: true });
    expect(existsSync(writing.snapshotFile)).toBe(false);

    let executionAck = { frame: false, snapshot: true };
    const stopExecution = writing.subscribe(() => {
      executionAck = ackedBeforeSnapshot("execution", executionId);
    });
    await recordRunStarted(writing, deps, {
      runId: executionId,
      chatId: "chat-offline",
      ticketId: "ticket-offline",
      destination,
    });
    stopExecution();
    expect(executionAck).toEqual({ frame: true, snapshot: false });

    await writing.flush();
    await rm(writing.snapshotFile, { force: true });
    expect(existsSync(writing.snapshotFile)).toBe(false);

    let changeSetAck = { frame: false, snapshot: true };
    const stopChangeSet = writing.subscribe(() => {
      changeSetAck = ackedBeforeSnapshot("change-set", changeSetId);
    });
    await recordChangeSetBaseline(writing, deps, {
      runId: executionId,
      baseline: { capturedAt: now.toISOString(), repos: [] },
      author: "agent:test",
      destination,
    });
    stopChangeSet();
    expect(changeSetAck).toEqual({ frame: true, snapshot: false });

    const committed = framesOf(writing.journalFile);
    expect(readFileSync(writing.journalFile).subarray(0, 5).toString("utf8")).toBe("BFJF1");
    expect(committed.some((frame) =>
      frame.records.some((record) => record.entityType === "audit-run" && record.id === auditRunId)
      && frame.events.some((event) => event.entityType === "audit-run" && event.clientEntityId === auditRunId && event.operation === "create" && event.idempotencyKey === `audit-run:create:${auditRunId}`),
    )).toBe(true);
    expect(committed.some((frame) =>
      frame.records.some((record) => record.entityType === "execution" && record.id === executionId)
      && frame.events.some((event) => event.entityType === "execution" && event.clientEntityId === executionId && event.operation === "create" && event.idempotencyKey === `execution:start:${executionId}`),
    )).toBe(true);
    expect(committed.some((frame) =>
      frame.records.some((record) => record.entityType === "change-set" && record.id === changeSetId)
      && frame.events.some((event) => event.entityType === "change-set" && event.clientEntityId === changeSetId && event.operation === "create"),
    )).toBe(true);

    await writing.flush();
    await rm(writing.snapshotFile, { force: true });
    expect(nodePath.basename(writing.snapshotFile)).toBe("local-first-v1.json");
    expect(existsSync(writing.snapshotFile)).toBe(false);

    const restarted = createVsCodeLocalFirstStore(host(root, state));
    const audit = await getLocalAuditRun(restarted, auditRunId);
    expect(audit?.record.payload).toMatchObject({
      auditId: "quality-audit",
      auditName: "Quality Audit",
      projectId: 11,
      status: "running",
      trigger: "manual",
      findingsCount: 0,
      source: { surface: "test" },
    });
    expect(audit?.record.payload.briefing).toContain("quality-audit");
    expect(audit?.record.destination).toEqual({ kind: "bound", projectId: "11" });

    const execution = await restarted.read((tx) => tx.get<{
      status: string;
      chatId?: string;
      ticketId?: string;
      checkpoint?: { step: number; safeToResume: boolean };
    }>("execution", executionId));
    expect(execution?.payload).toMatchObject({
      chatId: "chat-offline",
      ticketId: "ticket-offline",
      status: "running",
      checkpoint: { step: 0, safeToResume: false },
    });
    expect(execution?.destination).toEqual(destination);

    const changeSet = await readChangeSetLifecycle(restarted, executionId);
    expect(changeSet).toMatchObject({
      kind: "lifecycle",
      runId: executionId,
      author: "agent:test",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not acknowledge a transaction that throws, and a restart does not see it", async () => {
    vi.stubGlobal("fetch", fetchSpy);
    const root = await directory();
    const store = createVsCodeLocalFirstStore(host(root, new Map()));
    const now = new Date().toISOString();
    const record = {
      id: "chat-rollback",
      entityType: "chat" as const,
      schemaVersion: 1,
      payload: { title: "nope" },
      version: 1,
      occurredAt: now,
      updatedAt: now,
      destination: { kind: "unbound" as const },
    };
    await expect(store.transact(async (tx) => {
      await tx.put(record);
      await tx.append({
        eventId: "chat:chat-rollback",
        clientEntityId: record.id,
        entityType: "chat",
        operation: "create",
        schemaVersion: 1,
        occurredAt: record.updatedAt,
        dependsOn: [],
        destination: record.destination,
        payload: record.payload,
      });
      throw new Error("boom");
    })).rejects.toThrow("boom");

    await expect(store.read((tx) => tx.get("chat", record.id))).resolves.toBeUndefined();
    expect(existsSync(store.journalFile)).toBe(false);
    const restarted = createVsCodeLocalFirstStore(host(root, new Map()));
    await expect(restarted.read((tx) => tx.get("chat", record.id))).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reads the committed frame after a torn tail, and a later write still commits", async () => {
    vi.stubGlobal("fetch", fetchSpy);
    const root = await directory();
    const state = new Map<string, unknown>([["builderforce.localDeviceId", "device-1"]]);
    const writing = localBrainApplication(host(root, state));
    const chat = await writing.persistence.createChat({ title: "kept" });
    await writing.durableStore.flush();
    await appendFile(writing.durableStore.journalFile, Buffer.from([0xff, 0x00, 0x01]));

    const restarted = localBrainApplication(host(root, state));
    expect((await restarted.persistence.getChat(chat.id))?.title).toBe("kept");
    await restarted.persistence.sendMessages(chat.id, [{ role: "user", content: "after tear" }]);
    const again = localBrainApplication(host(root, state));
    expect((await again.persistence.getMessages(chat.id)).map((message) => message.content)).toEqual(["after tear"]);
    const last = framesOf(again.durableStore.journalFile).at(-1);
    expect(last?.records.some((record) => record.entityType === "message")).toBe(true);
    expect(last?.events.some((event) => event.entityType === "message")).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("recovers a corrupt snapshot to an empty store after preserving the file, and does not only throw", async () => {
    const root = await directory();
    const snapshot = nodePath.join(root, "local-first-v1.json");
    await writeFile(snapshot, "{not json");
    const store = createVsCodeLocalFirstStore(host(root, new Map()));
    await expect(store.read(async () => undefined)).resolves.toBeUndefined();
    const names = await readdir(root);
    const recovery = names.find((name) => name.includes("local-first-v1.json.corrupt-"));
    expect(recovery).toBeDefined();
    expect(existsSync(snapshot)).toBe(false);
    expect(existsSync(nodePath.join(root, recovery!))).toBe(true);
    expect(existsSync(store.journalFile)).toBe(false);
    const exported = await store.export();
    expect(exported.records).toEqual([]);
    expect(exported.events).toEqual([]);
    expect(exported.nextSequence).toBe(1);
    expect(JSON.stringify(exported)).not.toContain("{not json");

    const now = new Date().toISOString();
    await store.transact(async (tx) => {
      await tx.put({
        id: "chat-after-recovery",
        entityType: "chat",
        schemaVersion: 1,
        payload: { title: "recovered" },
        version: 1,
        occurredAt: now,
        updatedAt: now,
        destination: { kind: "unbound" },
      });
    });
    await expect(store.read((tx) => tx.get("chat", "chat-after-recovery"))).resolves.toMatchObject({
      id: "chat-after-recovery",
    });
    await store.flush();
    const again = createVsCodeLocalFirstStore(host(root, new Map()));
    await expect(again.read((tx) => tx.get("chat", "chat-after-recovery"))).resolves.toMatchObject({
      payload: { title: "recovered" },
    });
    await again.flush();
  });

  it("ignores a corrupt snapshot cache when the journal already has the chat", async () => {
    vi.stubGlobal("fetch", fetchSpy);
    const root = await directory();
    const state = new Map<string, unknown>([["builderforce.localDeviceId", "device-1"]]);
    const writing = localBrainApplication(host(root, state));
    const chat = await writing.persistence.createChat({ title: "from journal" });
    await writing.durableStore.flush();
    await writeFile(writing.durableStore.snapshotFile, "{not json");

    const restarted = localBrainApplication(host(root, state));
    expect((await restarted.persistence.getChat(chat.id))?.title).toBe("from journal");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
