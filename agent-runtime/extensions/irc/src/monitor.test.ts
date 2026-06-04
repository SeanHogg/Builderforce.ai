import { describe, expect, it } from "vitest";
import { resolveIrcInboundTarget } from "./monitor.js";

describe("irc monitor inbound target", () => {
  it("keeps channel target for group messages", () => {
    expect(
      resolveIrcInboundTarget({
        target: "#builderforce",
        senderNick: "alice",
      }),
    ).toEqual({
      isGroup: true,
      target: "#builderforce",
      rawTarget: "#builderforce",
    });
  });

  it("maps DM target to sender nick and preserves raw target", () => {
    expect(
      resolveIrcInboundTarget({
        target: "builderforce-bot",
        senderNick: "alice",
      }),
    ).toEqual({
      isGroup: false,
      target: "alice",
      rawTarget: "builderforce-bot",
    });
  });

  it("falls back to raw target when sender nick is empty", () => {
    expect(
      resolveIrcInboundTarget({
        target: "builderforce-bot",
        senderNick: " ",
      }),
    ).toEqual({
      isGroup: false,
      target: "builderforce-bot",
      rawTarget: "builderforce-bot",
    });
  });
});
