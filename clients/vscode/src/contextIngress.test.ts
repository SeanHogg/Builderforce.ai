import { describe, expect, it, vi } from "vitest";
import { mentionBudget } from "@builderforce/tool-output-policy";
import { INGRESS_COMPRESS_MIN_CHARS, ingressBlock } from "./contextIngress";
import { createAttachmentIngress, decodedLengthOf, MAX_STORED_ATTACHMENT_TEXTS, MAX_STORED_TEXT_CHARS } from "./attachmentIngress";

const longProse = "The release notes describe the change. ".repeat(Math.ceil(INGRESS_COMPRESS_MIN_CHARS / 39) + 5);
const halved = (text: string) => ({ text: text.slice(0, Math.floor(text.length / 2)), compressed: true, originalTokens: 1000, keptTokens: 500 });

describe("ingressBlock — inline + budget + compression", () => {
  it("compresses long prose (C8), never code, and records the saving", async () => {
    const compress = vi.fn(async (text: string, _kind: string) => halved(text));
    const log = vi.fn();
    const code = "export const x = 1;\n".repeat(200);
    const out = await ingressBlock(
      [{ name: "docs/notes.md", text: longProse }, { name: "src/x.ts", text: code }],
      mentionBudget("cloud"),
      { compress, log },
    );
    expect(compress).toHaveBeenCalledTimes(1);
    expect(compress.mock.calls[0]![1]).toBe("markdown");
    expect(out).toContain("Attached file: docs/notes.md (compressed for reading");
    expect(out).toContain(code.trimEnd());
    expect(log).toHaveBeenCalledWith(expect.stringContaining("docs/notes.md: attachment compressed (C8) 1000 → 500 tokens"));
  });

  it("leaves short prose, and everything when the lever is off, as it is", async () => {
    const compress = vi.fn(async (text: string) => halved(text));
    await ingressBlock([{ name: "a.md", text: "short" }], mentionBudget("cloud"), { compress });
    expect(compress).not.toHaveBeenCalled();
    const out = await ingressBlock([{ name: "notes.md", text: longProse }], mentionBudget("cloud"));
    expect(out).toContain(longProse.trimEnd().slice(0, 200));
    expect(out).not.toContain("compressed");
  });

  it("keeps the original when the compressor fails or does not shorten", async () => {
    const failing = vi.fn(async () => { throw new Error("desktop gone"); });
    expect(await ingressBlock([{ name: "n.log", text: longProse }], mentionBudget("cloud"), { compress: failing })).toContain(longProse.slice(0, 100));
    const noop = vi.fn(async (text: string) => ({ text, compressed: false, originalTokens: 0, keptTokens: 0 }));
    expect(await ingressBlock([{ name: "n.txt", text: longProse }], mentionBudget("cloud"), { compress: noop })).not.toContain("compressed");
  });

  it("fits to the local budget with a marker naming the cut file", async () => {
    const big = "line of code\n".repeat(2_000);
    const out = await ingressBlock([{ name: "src/big.ts", text: big }], mentionBudget("local"));
    expect(out).toContain("[src/big.ts truncated — showing the first");
    expect(out.length).toBeLessThan(mentionBudget("local").perFileChars + 400);
  });

  it("is empty for no texts", async () => {
    expect(await ingressBlock([], mentionBudget("cloud"))).toBe("");
  });
});

describe("the host's attachment ingress", () => {
  const ports = (over: Partial<Parameters<typeof createAttachmentIngress>[0]> = {}) => ({
    admit: vi.fn(),
    upload: vi.fn(async (f: { name: string; mime: string; bytes: Uint8Array }) => ({ key: `7/u/${f.name}`, name: f.name, type: f.mime, url: `https://api/api/brain/uploads/7/u/${f.name}` })),
    textTooLarge: (name: string) => `${name} is too large to attach`,
    sign: vi.fn(async (key: string) => `https://signed/${key}`),
    budget: vi.fn(async () => mentionBudget("cloud")),
    ...over,
  });

  it("stores a text and inlines it at send, naming the keys it covered", async () => {
    const p = ports();
    const ingress = createAttachmentIngress(p);
    await ingress.handle({ op: "store", key: "k1", name: "notes.md", text: "hello" });
    const r = await ingress.handle({ op: "inline", attachments: [{ key: "k1", name: "notes.md" }, { key: "k2", name: "a.pdf" }] });
    expect(r).toEqual({ text: "Attached file: notes.md\n```\nhello\n```", keys: ["k1"] });
    expect(p.budget).toHaveBeenCalledTimes(1);
  });

  it("answers null (links stay) when nothing it holds was attached, without resolving a budget", async () => {
    const p = ports();
    expect(await createAttachmentIngress(p).handle({ op: "inline", attachments: [{ key: "nope" }] })).toBeNull();
    expect(p.budget).not.toHaveBeenCalled();
  });

  it("uploads base64 bytes and signs a key", async () => {
    const p = ports();
    const ingress = createAttachmentIngress(p);
    const up = await ingress.handle({ op: "upload", name: "a.pdf", mime: "application/pdf", data: Buffer.from("%PDF").toString("base64") });
    expect(up).toMatchObject({ key: "7/u/a.pdf", url: "https://api/api/brain/uploads/7/u/a.pdf" });
    expect(Buffer.from((p.upload as ReturnType<typeof vi.fn>).mock.calls[0]![0].bytes).toString()).toBe("%PDF");
    expect(await ingress.handle({ op: "sign", key: "7/u/a.pdf" })).toBe("https://signed/7/u/a.pdf");
  });

  it("passes an upload refusal through as the person's sentence", async () => {
    const ingress = createAttachmentIngress(ports({ upload: vi.fn(async () => { throw new Error("Sign in to BuilderForce to attach a.pdf"); }) }));
    await expect(ingress.handle({ op: "upload", name: "a.pdf", data: "" })).rejects.toThrow("Sign in to BuilderForce to attach a.pdf");
    await expect(ingress.handle({ op: "bogus" })).rejects.toThrow(/Unsupported attachment operation/);
  });

  it("inlines a steered message's texts after its words", async () => {
    const ingress = createAttachmentIngress(ports());
    await ingress.handle({ op: "store", key: "k1", name: "ctx.txt", text: "context" });
    expect(await ingress.withInlined("look at this", [{ key: "k1" }])).toBe("look at this\n\nAttached file: ctx.txt\n```\ncontext\n```");
    expect(await ingress.withInlined("no attachments", undefined)).toBe("no attachments");
  });

  it("forgets the oldest stored text past the cap", async () => {
    const ingress = createAttachmentIngress(ports());
    for (let i = 0; i <= MAX_STORED_ATTACHMENT_TEXTS; i += 1) await ingress.handle({ op: "store", key: `k${i}`, name: `f${i}.txt`, text: `t${i}` });
    expect(await ingress.inline([{ key: "k0" }])).toBeNull();
    expect(await ingress.inline([{ key: `k${MAX_STORED_ATTACHMENT_TEXTS}` }])).not.toBeNull();
  });

  it("admits before it decodes: the upload carries `mime`, and a refusal stops it before the port", async () => {
    const p = ports();
    const ingress = createAttachmentIngress(p);
    const data = Buffer.from("%PDF-1").toString("base64");
    await ingress.handle({ op: "upload", name: "a.pdf", mime: "application/pdf", data });
    expect(p.admit).toHaveBeenCalledWith({ name: "a.pdf", mime: "application/pdf", size: 6 });
    expect((p.upload as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toMatchObject({ name: "a.pdf", mime: "application/pdf" });

    const refusing = ports({ admit: vi.fn(() => { throw new Error("Local only is on, so a.pdf stays on this machine"); }) });
    const strict = createAttachmentIngress(refusing);
    await expect(strict.handle({ op: "admit", name: "a.pdf", mime: "application/pdf", size: 10 })).rejects.toThrow("Local only is on");
    await expect(strict.handle({ op: "upload", name: "a.pdf", mime: "application/pdf", data })).rejects.toThrow("Local only is on");
    expect(refusing.upload).not.toHaveBeenCalled();
  });

  it("knows a base64 payload's decoded size without decoding it", () => {
    for (const raw of ["", "a", "ab", "abc", "abcd", "%PDF-1.7 binary"]) expect(decodedLengthOf(Buffer.from(raw).toString("base64"))).toBe(raw.length);
  });

  it("refuses one text over the cap with the person's sentence, and keeps none of it", async () => {
    const ingress = createAttachmentIngress(ports());
    await expect(ingress.handle({ op: "store", key: "big", name: "dump.log", text: "x".repeat(MAX_STORED_TEXT_CHARS + 1) })).rejects.toThrow("dump.log is too large to attach");
    expect(await ingress.inline([{ key: "big" }])).toBeNull();
  });

  it("forgets the oldest texts once the stored total passes its cap", async () => {
    const ingress = createAttachmentIngress(ports());
    const near = "y".repeat(MAX_STORED_TEXT_CHARS);
    for (let i = 0; i < 9; i += 1) await ingress.handle({ op: "store", key: `b${i}`, name: `b${i}.txt`, text: near });
    expect(await ingress.inline([{ key: "b0" }])).toBeNull();
    expect(await ingress.inline([{ key: "b8" }])).not.toBeNull();
  });

  it("steers synchronously — fitted, never compressed, under the last sent turn's budget", async () => {
    const compress = vi.fn(async (text: string) => halved(text));
    const p = ports({ compress });
    const ingress = createAttachmentIngress(p);
    await ingress.handle({ op: "store", key: "k1", name: "notes.md", text: longProse });
    const steered = ingress.withInlined("and this", [{ key: "k1" }]);
    expect(typeof steered).toBe("string");
    expect(steered).toContain("Attached file: notes.md");
    expect(compress).not.toHaveBeenCalled();
    expect(p.budget).not.toHaveBeenCalled();
  });
});
