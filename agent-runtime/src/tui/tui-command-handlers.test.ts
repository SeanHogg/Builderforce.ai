import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SettingItem } from "@mariozechner/pi-tui";
import { describe, expect, it, vi, type Mock } from "vitest";
import { loadConfig, writeConfigFile } from "../config/config.js";
import * as selectors from "./components/selectors.js";
import { createCommandHandlers } from "./tui-command-handlers.js";
import type { TuiStateAccess } from "./tui-types.js";

vi.mock("../config/config.js", async () => {
  const actual = await vi.importActual<typeof import("../config/config.js")>("../config/config.js");
  return {
    ...actual,
    loadConfig: vi.fn(actual.loadConfig),
    writeConfigFile: vi.fn(actual.writeConfigFile),
  };
});

describe("tui command handlers", () => {
  it("forwards unknown slash commands to the gateway", async () => {
    const sendChat = vi.fn().mockResolvedValue({ runId: "r1" });
    const addUser = vi.fn();
    const addSystem = vi.fn();
    const requestRender = vi.fn();
    const setActivityStatus = vi.fn();

    const { handleCommand } = createCommandHandlers({
      client: { sendChat } as never,
      chatLog: { addUser, addSystem } as never,
      tui: { requestRender } as never,
      opts: {},
      state: {
        currentSessionKey: "agent:main:main",
        activeChatRunId: null,
        sessionInfo: {},
      } as never,
      deliverDefault: false,
      openOverlay: vi.fn(),
      closeOverlay: vi.fn(),
      refreshSessionInfo: vi.fn(),
      loadHistory: vi.fn(),
      setSession: vi.fn(),
      refreshAgents: vi.fn(),
      abortActive: vi.fn(),
      setActivityStatus,
      formatSessionKey: vi.fn(),
      applySessionInfoFromPatch: vi.fn(),
      noteLocalRunId: vi.fn(),
    });

    await handleCommand("/context");

    expect(addSystem).not.toHaveBeenCalled();
    expect(addUser).toHaveBeenCalledWith("/context");
    expect(sendChat).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKey: "agent:main:main",
        message: "/context",
      }),
    );
    expect(requestRender).toHaveBeenCalled();
  });

  it("lets user toggle file logging via settings and persists config", async () => {
    // prepare config mocks
    (loadConfig as unknown as Mock).mockReturnValue({ logging: { enabled: true } });
    const openOverlay = vi.fn();
    const closeOverlay = vi.fn();

    let capturedItems: SettingItem[] = [];
    let capturedChange: (id: string, value: string) => void = () => {};
    const spy = vi
      .spyOn(selectors, "createSettingsList")
      .mockImplementation((items, onChange, _onCancel) => {
        capturedItems = items;
        capturedChange = onChange;
        return {} as ReturnType<typeof selectors.createSettingsList>;
      });

    const state = {
      currentSessionKey: "agent:main:main",
      activeChatRunId: null,
      sessionInfo: {},
      loggingEnabled: true,
    } as unknown as TuiStateAccess;

    const { openSettings } = createCommandHandlers({
      client: {} as never,
      chatLog: { addSystem: vi.fn() } as never,
      tui: { requestRender: vi.fn() } as never,
      opts: {},
      state,
      deliverDefault: false,
      openOverlay,
      closeOverlay,
      refreshSessionInfo: vi.fn(),
      loadHistory: vi.fn(),
      setSession: vi.fn(),
      refreshAgents: vi.fn(),
      abortActive: vi.fn(),
      setActivityStatus: vi.fn(),
      formatSessionKey: vi.fn(),
      applySessionInfoFromPatch: vi.fn(),
      noteLocalRunId: vi.fn(),
    });

    openSettings();

    expect(capturedItems.find((i) => i.id === "logging")).toBeTruthy();
    expect(capturedItems.find((i) => i.id === "logging")?.currentValue).toBe("on");

    // toggle off and ensure config write
    capturedChange("logging", "off");
    expect(state.loggingEnabled).toBe(false);
    expect(writeConfigFile).toHaveBeenCalledWith(
      expect.objectContaining({ logging: { enabled: false } }),
    );

    spy.mockRestore();
  });

  it("passes reset reason when handling /new and /reset", async () => {
    const resetSession = vi.fn().mockResolvedValue({ ok: true });
    const addSystem = vi.fn();
    const requestRender = vi.fn();
    const loadHistory = vi.fn().mockResolvedValue(undefined);

    const { handleCommand } = createCommandHandlers({
      client: { resetSession } as never,
      chatLog: { addSystem } as never,
      tui: { requestRender } as never,
      opts: {},
      state: {
        currentSessionKey: "agent:main:main",
        activeChatRunId: null,
        sessionInfo: {},
      } as never,
      deliverDefault: false,
      openOverlay: vi.fn(),
      closeOverlay: vi.fn(),
      refreshSessionInfo: vi.fn(),
      loadHistory,
      setSession: vi.fn(),
      refreshAgents: vi.fn(),
      abortActive: vi.fn(),
      setActivityStatus: vi.fn(),
      formatSessionKey: vi.fn(),
      applySessionInfoFromPatch: vi.fn(),
      noteLocalRunId: vi.fn(),
    });

    await handleCommand("/new");
    await handleCommand("/reset");

    expect(resetSession).toHaveBeenNthCalledWith(1, "agent:main:main", "new");
    expect(resetSession).toHaveBeenNthCalledWith(2, "agent:main:main", "reset");
    expect(loadHistory).toHaveBeenCalledTimes(2);
  });

  it("runs /gateway restart via service command runner", async () => {
    const addSystem = vi.fn();
    const requestRender = vi.fn();
    const runGatewayServiceCommand = vi.fn().mockResolvedValue({
      ok: true,
      lines: ["restarted"],
    });

    const { handleCommand } = createCommandHandlers({
      client: {} as never,
      chatLog: { addSystem } as never,
      tui: { requestRender } as never,
      opts: {},
      state: {
        currentSessionKey: "agent:main:main",
        activeChatRunId: null,
        sessionInfo: {},
      } as never,
      deliverDefault: false,
      openOverlay: vi.fn(),
      closeOverlay: vi.fn(),
      refreshSessionInfo: vi.fn(),
      loadHistory: vi.fn(),
      setSession: vi.fn(),
      refreshAgents: vi.fn(),
      abortActive: vi.fn(),
      setActivityStatus: vi.fn(),
      formatSessionKey: vi.fn(),
      applySessionInfoFromPatch: vi.fn(),
      noteLocalRunId: vi.fn(),
      runGatewayServiceCommand,
    });

    await handleCommand("/gateway restart");

    expect(runGatewayServiceCommand).toHaveBeenCalledWith("restart");
    expect(addSystem).toHaveBeenCalledWith("running: builderforce gateway restart");
    expect(addSystem).toHaveBeenCalledWith("restarted");
  });

  it("runs /restart locally without sending chat even when connected", async () => {
    const addSystem = vi.fn();
    const requestRender = vi.fn();
    const sendChat = vi.fn();
    const runGatewayServiceCommand = vi.fn().mockResolvedValue({
      ok: true,
      lines: ["restarted"],
    });

    const { handleCommand } = createCommandHandlers({
      client: { sendChat } as never,
      chatLog: { addSystem } as never,
      tui: { requestRender } as never,
      opts: {},
      state: {
        currentSessionKey: "agent:main:main",
        activeChatRunId: null,
        sessionInfo: {},
        isConnected: true,
      } as never,
      deliverDefault: false,
      openOverlay: vi.fn(),
      closeOverlay: vi.fn(),
      refreshSessionInfo: vi.fn(),
      loadHistory: vi.fn(),
      setSession: vi.fn(),
      refreshAgents: vi.fn(),
      abortActive: vi.fn(),
      setActivityStatus: vi.fn(),
      formatSessionKey: vi.fn(),
      applySessionInfoFromPatch: vi.fn(),
      noteLocalRunId: vi.fn(),
      runGatewayServiceCommand,
    });

    await handleCommand("/restart");

    expect(runGatewayServiceCommand).toHaveBeenCalledWith("restart");
    expect(sendChat).not.toHaveBeenCalled();
    expect(addSystem).toHaveBeenCalledWith("Running: builderforce gateway restart");
    expect(addSystem).toHaveBeenCalledWith("Gateway restart started. Reconnecting when it is up…");
  });

  it("treats /daemon as alias for /gateway", async () => {
    const addSystem = vi.fn();
    const runGatewayServiceCommand = vi.fn().mockResolvedValue({ ok: true, lines: [] });

    const { handleCommand } = createCommandHandlers({
      client: {} as never,
      chatLog: { addSystem } as never,
      tui: { requestRender: vi.fn() } as never,
      opts: {},
      state: {
        currentSessionKey: "agent:main:main",
        activeChatRunId: null,
        sessionInfo: {},
      } as never,
      deliverDefault: false,
      openOverlay: vi.fn(),
      closeOverlay: vi.fn(),
      refreshSessionInfo: vi.fn(),
      loadHistory: vi.fn(),
      setSession: vi.fn(),
      refreshAgents: vi.fn(),
      abortActive: vi.fn(),
      setActivityStatus: vi.fn(),
      formatSessionKey: vi.fn(),
      applySessionInfoFromPatch: vi.fn(),
      noteLocalRunId: vi.fn(),
      runGatewayServiceCommand,
    });

    await handleCommand("/daemon status");

    expect(runGatewayServiceCommand).toHaveBeenCalledWith("status");
    expect(addSystem).toHaveBeenCalledWith("running: builderforce gateway status");
  });

  it("runs models set and updates state for /model command", async () => {
    const addSystem = vi.fn();
    const patchSession = vi.fn().mockResolvedValue({ ok: true });
    const runLocalCliCommand = vi.fn().mockResolvedValue({ ok: true, lines: [] });
    const sessionInfo: Record<string, unknown> = {};

    const { handleCommand } = createCommandHandlers({
      client: { patchSession } as never,
      chatLog: { addSystem } as never,
      tui: { requestRender: vi.fn() } as never,
      opts: {},
      state: {
        currentSessionKey: "agent:main:main",
        activeChatRunId: null,
        sessionInfo,
      } as never,
      deliverDefault: false,
      openOverlay: vi.fn(),
      closeOverlay: vi.fn(),
      refreshSessionInfo: vi.fn(),
      loadHistory: vi.fn(),
      setSession: vi.fn(),
      refreshAgents: vi.fn(),
      abortActive: vi.fn(),
      setActivityStatus: vi.fn(),
      formatSessionKey: vi.fn(),
      applySessionInfoFromPatch: vi.fn(),
      updateFooter: vi.fn(),
      noteLocalRunId: vi.fn(),
      runLocalCliCommand,
    });

    await handleCommand("/model openrouter/google/gemma-3-27b-it:free");

    // Should run `models set` to update config + allowlist
    expect(runLocalCliCommand).toHaveBeenCalledWith([
      "models",
      "set",
      "openrouter/google/gemma-3-27b-it:free",
    ]);
    // State should be updated immediately with the new model
    expect(sessionInfo.modelProvider).toBe("openrouter");
    expect(sessionInfo.model).toBe("google/gemma-3-27b-it:free");
    expect(addSystem).toHaveBeenCalledWith("model set to openrouter/google/gemma-3-27b-it:free");
  });

  it("launches setup when switching to builderforcellm without registration", async () => {
    const previousStateDir = process.env.BUILDERFORCE_AGENTS_STATE_DIR;
    const previousLinkKey = process.env.BUILDERFORCE_API_KEY;
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "builderforce-tui-setup-"));
    process.env.BUILDERFORCE_AGENTS_STATE_DIR = tempDir;
    delete process.env.BUILDERFORCE_API_KEY;

    const addSystem = vi.fn();
    const runLocalCliCommand = vi.fn().mockResolvedValue({ ok: true, lines: [] });
    const onSetup = vi.fn().mockResolvedValue(undefined);

    try {
      const { handleCommand } = createCommandHandlers({
        client: { patchSession: vi.fn().mockResolvedValue({ ok: true }) } as never,
        chatLog: { addSystem } as never,
        tui: { requestRender: vi.fn() } as never,
        opts: {},
        state: {
          currentSessionKey: "agent:main:main",
          activeChatRunId: null,
          sessionInfo: {},
        } as never,
        deliverDefault: false,
        openOverlay: vi.fn(),
        closeOverlay: vi.fn(),
        refreshSessionInfo: vi.fn(),
        loadHistory: vi.fn(),
        setSession: vi.fn(),
        refreshAgents: vi.fn(),
        abortActive: vi.fn(),
        setActivityStatus: vi.fn(),
        formatSessionKey: vi.fn(),
        applySessionInfoFromPatch: vi.fn(),
        updateFooter: vi.fn(),
        noteLocalRunId: vi.fn(),
        runLocalCliCommand,
        onSetup,
      });

      await handleCommand("/model builderforcellm/auto");

      expect(onSetup).toHaveBeenCalledTimes(1);
      expect(runLocalCliCommand).not.toHaveBeenCalled();
      expect(addSystem).toHaveBeenCalledWith(
        "builderforcellm requires Builderforce registration. Launching setup wizard...",
      );
      expect(addSystem).not.toHaveBeenCalledWith("model set to builderforcellm/auto");
    } finally {
      if (previousStateDir === undefined) {
        delete process.env.BUILDERFORCE_AGENTS_STATE_DIR;
      } else {
        process.env.BUILDERFORCE_AGENTS_STATE_DIR = previousStateDir;
      }
      if (previousLinkKey === undefined) {
        delete process.env.BUILDERFORCE_API_KEY;
      } else {
        process.env.BUILDERFORCE_API_KEY = previousLinkKey;
      }
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("shows usage hint when /spec is called without a goal", async () => {
    const addSystem = vi.fn();
    const requestRender = vi.fn();

    const { handleCommand } = createCommandHandlers({
      client: {} as never,
      chatLog: { addSystem, hasUserMessages: () => false } as never,
      tui: { requestRender } as never,
      opts: {},
      state: {
        currentSessionKey: "agent:main:main",
        activeChatRunId: null,
        sessionInfo: {},
        isConnected: true,
      } as never,
      deliverDefault: false,
      openOverlay: vi.fn(),
      closeOverlay: vi.fn(),
      refreshSessionInfo: vi.fn(),
      loadHistory: vi.fn(),
      setSession: vi.fn(),
      refreshAgents: vi.fn(),
      abortActive: vi.fn(),
      setActivityStatus: vi.fn(),
      formatSessionKey: vi.fn(),
      applySessionInfoFromPatch: vi.fn(),
      noteLocalRunId: vi.fn(),
    });

    await handleCommand("/spec");

    expect(addSystem).toHaveBeenCalledWith(expect.stringContaining("Usage: /spec <goal>"));
  });

  it("sends a planning workflow message when /spec is called with a goal", async () => {
    const sendChat = vi.fn().mockResolvedValue({ runId: "r1" });
    const addUser = vi.fn();
    const addSystem = vi.fn();
    const requestRender = vi.fn();

    const { handleCommand } = createCommandHandlers({
      client: { sendChat } as never,
      chatLog: { addUser, addSystem, hasUserMessages: () => false } as never,
      tui: { requestRender } as never,
      opts: {},
      state: {
        currentSessionKey: "agent:main:main",
        activeChatRunId: null,
        sessionInfo: {},
        isConnected: true,
      } as never,
      deliverDefault: false,
      openOverlay: vi.fn(),
      closeOverlay: vi.fn(),
      refreshSessionInfo: vi.fn(),
      loadHistory: vi.fn(),
      setSession: vi.fn(),
      refreshAgents: vi.fn(),
      abortActive: vi.fn(),
      setActivityStatus: vi.fn(),
      formatSessionKey: vi.fn(),
      applySessionInfoFromPatch: vi.fn(),
      noteLocalRunId: vi.fn(),
    });

    await handleCommand("/spec Add real-time collaboration");

    expect(sendChat).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("Add real-time collaboration") }),
    );
    expect(sendChat).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("planning") }),
    );
  });

  it("sends a workflow status request when /workflow is called without an id", async () => {
    const sendChat = vi.fn().mockResolvedValue({ runId: "r1" });
    const addUser = vi.fn();
    const addSystem = vi.fn();
    const requestRender = vi.fn();

    const { handleCommand } = createCommandHandlers({
      client: { sendChat } as never,
      chatLog: { addUser, addSystem, hasUserMessages: () => false } as never,
      tui: { requestRender } as never,
      opts: {},
      state: {
        currentSessionKey: "agent:main:main",
        activeChatRunId: null,
        sessionInfo: {},
        isConnected: true,
      } as never,
      deliverDefault: false,
      openOverlay: vi.fn(),
      closeOverlay: vi.fn(),
      refreshSessionInfo: vi.fn(),
      loadHistory: vi.fn(),
      setSession: vi.fn(),
      refreshAgents: vi.fn(),
      abortActive: vi.fn(),
      setActivityStatus: vi.fn(),
      formatSessionKey: vi.fn(),
      applySessionInfoFromPatch: vi.fn(),
      noteLocalRunId: vi.fn(),
    });

    await handleCommand("/workflow");

    expect(sendChat).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("workflow_status") }),
    );
  });

  it("includes the workflow id in the status request when /workflow <id> is called", async () => {
    const sendChat = vi.fn().mockResolvedValue({ runId: "r1" });
    const addUser = vi.fn();
    const addSystem = vi.fn();
    const requestRender = vi.fn();

    const { handleCommand } = createCommandHandlers({
      client: { sendChat } as never,
      chatLog: { addUser, addSystem, hasUserMessages: () => false } as never,
      tui: { requestRender } as never,
      opts: {},
      state: {
        currentSessionKey: "agent:main:main",
        activeChatRunId: null,
        sessionInfo: {},
        isConnected: true,
      } as never,
      deliverDefault: false,
      openOverlay: vi.fn(),
      closeOverlay: vi.fn(),
      refreshSessionInfo: vi.fn(),
      loadHistory: vi.fn(),
      setSession: vi.fn(),
      refreshAgents: vi.fn(),
      abortActive: vi.fn(),
      setActivityStatus: vi.fn(),
      formatSessionKey: vi.fn(),
      applySessionInfoFromPatch: vi.fn(),
      noteLocalRunId: vi.fn(),
    });

    await handleCommand("/workflow abc-123");

    expect(sendChat).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("abc-123") }),
    );
  });

  it("shows handoff hint on /new when session has user messages", async () => {
    const resetSession = vi.fn().mockResolvedValue({ ok: true });
    const addSystem = vi.fn();
    const requestRender = vi.fn();
    const loadHistory = vi.fn().mockResolvedValue(undefined);

    const { handleCommand } = createCommandHandlers({
      client: { resetSession } as never,
      chatLog: { addSystem, hasUserMessages: () => true } as never,
      tui: { requestRender } as never,
      opts: {},
      state: {
        currentSessionKey: "agent:main:main",
        activeChatRunId: null,
        sessionInfo: {},
        isConnected: true,
      } as never,
      deliverDefault: false,
      openOverlay: vi.fn(),
      closeOverlay: vi.fn(),
      refreshSessionInfo: vi.fn(),
      loadHistory,
      setSession: vi.fn(),
      refreshAgents: vi.fn(),
      abortActive: vi.fn(),
      setActivityStatus: vi.fn(),
      formatSessionKey: vi.fn(),
      applySessionInfoFromPatch: vi.fn(),
      noteLocalRunId: vi.fn(),
    });

    await handleCommand("/new");

    expect(addSystem).toHaveBeenCalledWith(expect.stringContaining("/handoff"));
    expect(resetSession).toHaveBeenCalledWith("agent:main:main", "new");
  });

  it("skips handoff hint on /new when session has no user messages", async () => {
    const resetSession = vi.fn().mockResolvedValue({ ok: true });
    const addSystem = vi.fn();
    const requestRender = vi.fn();
    const loadHistory = vi.fn().mockResolvedValue(undefined);

    const { handleCommand } = createCommandHandlers({
      client: { resetSession } as never,
      chatLog: { addSystem, hasUserMessages: () => false } as never,
      tui: { requestRender } as never,
      opts: {},
      state: {
        currentSessionKey: "agent:main:main",
        activeChatRunId: null,
        sessionInfo: {},
        isConnected: true,
      } as never,
      deliverDefault: false,
      openOverlay: vi.fn(),
      closeOverlay: vi.fn(),
      refreshSessionInfo: vi.fn(),
      loadHistory,
      setSession: vi.fn(),
      refreshAgents: vi.fn(),
      abortActive: vi.fn(),
      setActivityStatus: vi.fn(),
      formatSessionKey: vi.fn(),
      applySessionInfoFromPatch: vi.fn(),
      noteLocalRunId: vi.fn(),
    });

    await handleCommand("/new");

    const calls = addSystem.mock.calls.map((c: string[]) => c[0]);
    expect(calls.some((msg: string) => msg.includes("/handoff"))).toBe(false);
    expect(resetSession).toHaveBeenCalledWith("agent:main:main", "new");
  });
});
