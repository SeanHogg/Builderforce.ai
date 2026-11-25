import { describe, expect, it, vi } from "vitest";
import { dataUrlBytes, downloadAttachment, ownAttachmentPath, safeFileName, type AttachmentDownloadPorts } from "./attachmentDownload";

const BASE = "https://api.builderforce.test";

function ports(overrides: Partial<AttachmentDownloadPorts<string>> = {}) {
  const written: Array<{ target: string; bytes: Uint8Array }> = [];
  const p: AttachmentDownloadPorts<string> = {
    baseUrl: () => BASE,
    fetchOwn: vi.fn(async () => new Uint8Array([1, 2, 3])),
    chooseTarget: vi.fn(async (name: string) => `/saved/${name}`),
    write: vi.fn(async (target: string, bytes: Uint8Array) => { written.push({ target, bytes }); }),
    unavailable: (name) => `${name} is gone`,
    foreign: (name) => `${name} is foreign`,
    tooLarge: (name) => `${name} is too large`,
    ...overrides,
  };
  return { p, written };
}

describe("attachment.download — the host saves an attachment's original", () => {
  it("regression: fetches an account URL with the credential (by its path) and saves it where the person chose", async () => {
    const { p, written } = ports();
    const answer = await downloadAttachment({ name: "spec.pdf", url: `${BASE}/api/brain/uploads/k1` }, p);
    expect(answer).toEqual({ saved: true });
    expect(p.fetchOwn).toHaveBeenCalledWith("/api/brain/uploads/k1", "spec.pdf");
    expect(p.chooseTarget).toHaveBeenCalledWith("spec.pdf");
    expect(written).toEqual([{ target: "/saved/spec.pdf", bytes: new Uint8Array([1, 2, 3]) }]);
  });

  it("reads a signed copy too (its query kept)", async () => {
    const { p } = ports();
    await downloadAttachment({ name: "a.png", url: `${BASE}/api/brain-files/k1?exp=1&sig=s` }, p);
    expect(p.fetchOwn).toHaveBeenCalledWith("/api/brain-files/k1?exp=1&sig=s", "a.png");
  });

  it("regression: never sends the credential to another origin, or to a non-attachment path on ours", async () => {
    const { p } = ports();
    for (const url of [
      "https://evil.test/api/brain/uploads/k1",
      "https://api.builderforce.test.evil/api/brain/uploads/k",
      `${BASE}/api/admin/users`,
      `${BASE}/api/brain/uploads/`,
      `${BASE}/api/brain/uploads/../admin`,
      `${BASE}/api/brain/uploads/%2e%2e/admin`,
    ]) {
      await expect(downloadAttachment({ name: "x.png", url }, p)).rejects.toThrow("x.png is foreign");
    }
    expect(p.fetchOwn).not.toHaveBeenCalled();
    expect(p.chooseTarget).not.toHaveBeenCalled();
  });

  it("saves bytes the webview read from its own blob: URL, and a data: URL as decoded", async () => {
    const { p, written } = ports();
    await downloadAttachment({ name: "a.txt", data: Buffer.from("hello").toString("base64") }, p);
    await downloadAttachment({ name: "b.png", url: `data:image/png;base64,${Buffer.from("png!").toString("base64")}` }, p);
    expect(Buffer.from(written[0]!.bytes).toString()).toBe("hello");
    expect(Buffer.from(written[1]!.bytes).toString()).toBe("png!");
    expect(p.fetchOwn).not.toHaveBeenCalled();
  });

  it("answers saved:false when the person cancels the dialog, and writes nothing", async () => {
    const { p, written } = ports({ chooseTarget: vi.fn(async () => undefined) });
    expect(await downloadAttachment({ name: "a.txt", data: "aGk=" }, p)).toEqual({ saved: false });
    expect(written).toEqual([]);
  });

  it("reports the person's sentence when the account refuses, before asking where to save", async () => {
    const { p } = ports({ fetchOwn: vi.fn(async () => { throw new Error("Sign in to BuilderForce to download spec.pdf."); }) });
    await expect(downloadAttachment({ name: "spec.pdf", url: `${BASE}/api/brain/uploads/k1` }, p)).rejects.toThrow("Sign in to BuilderForce to download spec.pdf.");
    expect(p.chooseTarget).not.toHaveBeenCalled();
  });

  it("refuses a link with no reachable copy (a dead blob: URL, a malformed data: URL) as unavailable", async () => {
    const { p } = ports();
    await expect(downloadAttachment({ name: "a.png", url: "blob:vscode-webview://x/1" }, p)).rejects.toThrow("a.png is gone");
    await expect(downloadAttachment({ name: "a.txt", url: "data:text/plain,%E0%A4%A" }, p)).rejects.toThrow("a.txt is gone");
  });

  it("offers a safe file name: no folders, no reserved characters, names or trailing dots", () => {
    expect(safeFileName("../../etc/pa:ss?.txt")).toBe("pa_ss_.txt");
    expect(safeFileName("")).toBe("attachment");
    expect(safeFileName("CON")).toBe("_CON");
    expect(safeFileName("nul.txt")).toBe("_nul.txt");
    expect(safeFileName("lpt9.log")).toBe("_lpt9.log");
    expect(safeFileName("console.txt")).toBe("console.txt");
    expect(safeFileName("report. . ")).toBe("report");
    expect(safeFileName("...")).toBe("attachment");
  });

  it("decodes plain data: URLs and rejects malformed ones", () => {
    expect(Buffer.from(dataUrlBytes("data:text/plain,hi%20there")!).toString()).toBe("hi there");
    expect(dataUrlBytes("data:text/plain,%E0%A4%A")).toBeNull();
    expect(dataUrlBytes("https://x")).toBeNull();
  });

  it("reads an attachment path only under the base URL's own path", () => {
    expect(ownAttachmentPath("https://h.test/v1/api/brain/uploads/k", "https://h.test/v1")).toBe("/api/brain/uploads/k");
    expect(ownAttachmentPath("https://h.test/api/brain/uploads/k", "https://h.test/v1")).toBeNull();
    expect(ownAttachmentPath("not a url", BASE)).toBeNull();
  });
});
