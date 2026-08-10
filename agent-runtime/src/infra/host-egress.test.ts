import { afterEach, describe, expect, it, vi } from "vitest";

import { performHostEgress, rejectEgressTarget } from "./host-egress.js";

/**
 * Host egress lets the Builderforce cloud have this machine make one outbound call,
 * because some providers refuse cloud egress but not an ordinary client. That is a
 * capability pointed at the user's own network, so the tests that matter most are the
 * ones about what it REFUSES: without the fence, anything able to reach the relay
 * could make a user's machine fetch arbitrary URLs, including localhost and RFC1918
 * addresses the public internet cannot see.
 */

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("egress destination fence", () => {
  it("allows the provider it exists for", () => {
    expect(rejectEgressTarget("https://api.kimi.com/coding/v1/chat/completions")).toBeNull();
  });

  it("refuses hosts that are not on the allowlist", () => {
    for (const url of [
      "https://example.com/",
      "https://api.openai.com/v1/chat/completions",
      // Lookalikes: a suffix/prefix check would let both of these through.
      "https://api.kimi.com.evil.test/",
      "https://evil.test/?x=api.kimi.com",
    ]) {
      expect(rejectEgressTarget(url)).toMatch(/host not allowed/);
    }
  });

  it("refuses the private network and loopback", () => {
    // The whole point of the fence: this process sits INSIDE a network the caller
    // cannot otherwise reach.
    for (const url of [
      "http://127.0.0.1:8080/",
      "https://192.168.1.1/admin",
      "https://10.0.0.5/",
      "http://[::1]:9000/",
      "http://169.254.169.254/latest/meta-data/",
    ]) {
      expect(rejectEgressTarget(url)).not.toBeNull();
    }
  });

  it("refuses plaintext http, so a relayed credential never rides the wire in the clear", () => {
    expect(rejectEgressTarget("http://api.kimi.com/coding/v1/chat/completions"))
      .toMatch(/only https/);
  });

  it("refuses a missing or malformed url", () => {
    expect(rejectEgressTarget(undefined)).toMatch(/url required/);
    expect(rejectEgressTarget("not-a-url")).toMatch(/malformed/);
  });
});

describe("performing an allowlisted call", () => {
  it("returns the provider's status, body and correlation headers", async () => {
    globalThis.fetch = vi.fn(async () => new Response(
      JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
      { status: 200, headers: { "content-type": "application/json", "cf-ray": "ray-1" } },
    )) as unknown as typeof fetch;

    const frame = await performHostEgress({
      requestId: "req-1",
      url: "https://api.kimi.com/coding/v1/chat/completions",
      headers: { Authorization: "Bearer sk-kimi" },
      body: '{"model":"kimi-for-coding"}',
    });

    expect(frame.type).toBe("host.egress.response");
    expect(frame.requestId).toBe("req-1");
    expect(frame.response?.status).toBe(200);
    expect(frame.response?.headers["cf-ray"]).toBe("ray-1");
    expect(JSON.parse(frame.response!.body).choices[0].message.content).toBe("ok");
  });

  it("relays a provider REJECTION as a response, not as an error", async () => {
    // A 403 from the provider is a real answer the gateway must classify itself; if it
    // came back as `error` the cascade would read it as "the relay broke" instead.
    globalThis.fetch = vi.fn(async () => new Response("<html>Forbidden</html>", {
      status: 403, headers: { "content-type": "text/html" },
    })) as unknown as typeof fetch;

    const frame = await performHostEgress({
      requestId: "req-2",
      url: "https://api.kimi.com/coding/v1/chat/completions",
    });

    expect(frame.error).toBeUndefined();
    expect(frame.response?.status).toBe(403);
    expect(frame.response?.headers["content-type"]).toBe("text/html");
  });

  it("does not follow redirects", async () => {
    const seen: RequestInit[] = [];
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      seen.push(init);
      return new Response(null, { status: 302, headers: { location: "https://evil.test/" } });
    }) as unknown as typeof fetch;

    await performHostEgress({
      requestId: "req-3",
      url: "https://api.kimi.com/coding/v1/chat/completions",
    });

    // A followed 302 is the obvious way to walk an allowlisted host somewhere else.
    expect(seen[0]).toMatchObject({ redirect: "manual" });
  });

  it("never throws — a blocked destination comes back as an error frame", async () => {
    // The cloud caller is blocked on a correlated reply; an exception here would
    // strand it until the relay's timeout instead of failing it immediately.
    const frame = await performHostEgress({ requestId: "req-4", url: "https://example.com/" });
    expect(frame.requestId).toBe("req-4");
    expect(frame.error).toMatch(/host not allowed/);
    expect(frame.response).toBeUndefined();
  });

  it("reports a network failure as an error frame", async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
    const frame = await performHostEgress({
      requestId: "req-5",
      url: "https://api.kimi.com/coding/v1/chat/completions",
    });
    expect(frame.error).toContain("ECONNREFUSED");
  });
});
