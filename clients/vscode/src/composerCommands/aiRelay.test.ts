import { describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

// The transport pulls in the editor API; the relay is given its fetch in these tests.
vi.mock("../bfApi/transport", () => ({ fetchAuthed: vi.fn() }));

import { CHAT_COMPLETIONS_PATH, vsixForwardAi } from "./aiRelay";

const secrets = {} as vscode.SecretStorage;
const encoder = new TextEncoder();
const request = { resourceId: "chat", body: encoder.encode('{"model":"m"}'), stream: true };

function streamed(...parts: string[]): Response {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    },
  }));
}

async function collect(source: AsyncIterable<Uint8Array>): Promise<string> {
  let text = "";
  for await (const chunk of source) text += new TextDecoder().decode(chunk);
  return text;
}

describe("vsixForwardAi", () => {
  it("posts the body to the completions route and streams the chunks", async () => {
    const authed = vi.fn(async () => streamed("data: a\n\n", "data: b\n\n"));
    const text = await collect(vsixForwardAi(secrets, authed as never)(request, new AbortController().signal));
    expect(text).toBe("data: a\n\ndata: b\n\n");
    expect(authed).toHaveBeenCalledWith(secrets, CHAT_COMPLETIONS_PATH, expect.objectContaining({ method: "POST", body: request.body }));
  });

  it("throws when the user is not signed in", async () => {
    const authed = vi.fn(async () => undefined);
    await expect(collect(vsixForwardAi(secrets, authed as never)(request, new AbortController().signal))).rejects.toThrow("Not signed in");
  });

  it("throws on a non-ok status without echoing the body", async () => {
    const authed = vi.fn(async () => new Response("secret detail", { status: 429 }));
    const failure = collect(vsixForwardAi(secrets, authed as never)(request, new AbortController().signal));
    await expect(failure).rejects.toThrow("The model gateway answered 429.");
    await expect(failure).rejects.not.toThrow(/secret detail/);
  });

  it("passes the abort signal through", async () => {
    const authed = vi.fn(async () => streamed("x"));
    const controller = new AbortController();
    await collect(vsixForwardAi(secrets, authed as never)(request, controller.signal));
    expect((authed.mock.calls[0] as unknown as [unknown, unknown, { signal: AbortSignal }])[2].signal).toBe(controller.signal);
  });
});
