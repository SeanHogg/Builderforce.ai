import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  INDEXEDDB_REDACTED_KEYS,
  INDEXEDDB_REDACTION_RULE,
  newLocalRecord,
  redactSnapshotForUploadOrLog,
} from "@builderforce/local-first";
import { VSIX_LOCAL_FIRST_REDACTION_RULE } from "./durableLocalFirstStore";
import { createVsCodeLocalFirstStore } from "./localFirstStore";

vi.mock("vscode", () => ({
  l10n: { t: (message: string) => message },
}));

type Host = Parameters<typeof createVsCodeLocalFirstStore>[0];

function host(directory: string): Host {
  return {
    globalStorageUri: { fsPath: directory },
  } as unknown as Host;
}

describe("local-first upload redaction", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it("keeps secrets in export() and strips them from exportForUploadOrLog() without mutating the input", async () => {
    const root = await mkdtemp(nodePath.join(tmpdir(), "bf-local-first-redact-"));
    directories.push(root);
    const store = createVsCodeLocalFirstStore(host(root));
    const payload = {
      title: "Redaction rule",
      accessToken: "secret-token",
      nested: { client_secret: "secret-value", note: "kept" },
    };
    const record = newLocalRecord({
      id: "ticket-redact",
      entityType: "ticket",
      payload,
      deviceId: "device-a",
    });
    const before = structuredClone(record);

    await store.transact(async (tx) => {
      await tx.put(record);
    });

    expect(record).toEqual(before);
    expect(record.payload).toBe(payload);
    expect(payload.accessToken).toBe("secret-token");
    expect(payload.nested.client_secret).toBe("secret-value");

    const local = await store.export();
    expect(JSON.stringify(local)).toContain("secret-token");
    expect(JSON.stringify(local)).toContain("secret-value");

    const uploadable = await store.exportForUploadOrLog();
    expect(JSON.stringify(uploadable)).not.toContain("secret-token");
    expect(JSON.stringify(uploadable)).not.toContain("secret-value");
    const uploaded = uploadable.records[0]?.payload as {
      title?: string;
      accessToken?: string;
      nested?: { client_secret?: string; note?: string };
    };
    expect(uploaded.accessToken).toBeUndefined();
    expect(uploaded.nested).toEqual({ note: "kept" });
    expect(uploaded.title).toBe("Redaction rule");

    expect(record).toEqual(before);
    expect(record.payload).toBe(payload);
    expect(payload.accessToken).toBe("secret-token");
    expect(payload.nested.client_secret).toBe("secret-value");
    await store.flush();

    // Stated on this surface. Same words as the IndexedDB adapter, not a second policy.
    expect(VSIX_LOCAL_FIRST_REDACTION_RULE).toBe(INDEXEDDB_REDACTION_RULE);
    expect(INDEXEDDB_REDACTED_KEYS).toContain("token");
    expect(VSIX_LOCAL_FIRST_REDACTION_RULE).toMatch(/exportForUploadOrLog/);
    expect(VSIX_LOCAL_FIRST_REDACTION_RULE).toMatch(/accessToken/);
    expect(redactSnapshotForUploadOrLog).toBeTypeOf("function");
  });
});
