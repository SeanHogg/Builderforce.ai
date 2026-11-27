import * as vscode from "vscode";
import * as bfApi from "../bfApi";
import { reportExtensionError, logLine } from "../diagnostics/errorReporter";
import { SECRET_KEY } from "../gateway/gateway";
import { createAgentsGate } from "./agentsGate";
import { createExperienceHostProvider } from "./experienceHost";
import { createPhoneApprovalRelay } from "./phoneApprovalRelay";
import { createRoutineScheduler } from "./routineScheduler";
import { createSkillOps } from "./skillOps";
import { createSkillRunner } from "./skillRunner";
import type { RunnerMessages } from "./skillRunnerPorts";
import { createSkillSecrets } from "./skillSecrets";
import { SkillsController, type SkillsHostUi } from "./skillsController";
import { SkillsViewProvider } from "./skillsView";
import { skillsLabels } from "./skillsViewLabels";
import { createTeachHelper, resolveHelperBinary } from "./teachHelper";
import { trainPrivateModel } from "./trainPrivateModel";

/**
 * Self-directed agents (Teach once, run, schedule, phone approvals), wired up in one place:
 * `extension.ts` makes the single call `registerExperience(context)`. Everything is built
 * here from small ports, so each part stays testable on its own.
 *
 * Nothing acts until `builderforce.agents.enabled` is on with consent; the helper process
 * is only spawned on first use; and where the vendored helper is absent (Linux, or a build
 * without it) the view says "Not available on this system" and the commands stay hidden.
 */

const SUPPORTED_KEY = "builderforce.agents.supported";

/** Resolves after `ms`, or as soon as `signal` aborts. */
const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });

function runnerMessages(): RunnerMessages {
  return {
    orphaned: vscode.l10n.t("Synapse closed during the run"),
    unsupported: vscode.l10n.t("Not available on this system"),
    busy: vscode.l10n.t("A skill is already running."),
    unknownSkill: (id) => vscode.l10n.t("Skill {0} was not found.", id),
    approvalDescription: (skill, step, action) => vscode.l10n.t("{0}: step {1} needs your approval ({2})", skill, step, action),
    // A fact for later recall, not UI: kept in plain English like every other memory.
    lastRun: (skill, status, whenIso, trigger) => `Skill "${skill}" ${status} at ${whenIso} (${trigger} run).`,
  };
}

function hostUi(gate: ReturnType<typeof createAgentsGate>, secrets: vscode.SecretStorage): SkillsHostUi {
  return {
    enabled: gate.enabled,
    phoneApprovals: gate.phoneApprovals,
    signedIn: async () => !!(await secrets.get(SECRET_KEY)),
    enable: gate.enable,
    setPhoneApprovals: gate.setPhoneApprovals,
    async pickProgram() {
      const mac = process.platform === "darwin";
      const picked = await vscode.window.showOpenDialog({
        canSelectMany: false,
        canSelectFiles: true,
        canSelectFolders: mac,
        title: vscode.l10n.t("Choose the program to teach"),
        openLabel: vscode.l10n.t("Choose program"),
        filters: mac ? { [vscode.l10n.t("Applications")]: ["app"] } : { [vscode.l10n.t("Programs")]: ["exe"] },
      });
      return picked?.[0]?.fsPath;
    },
    async confirmDelete(name) {
      const del = vscode.l10n.t("Delete");
      const answer = await vscode.window.showWarningMessage(
        vscode.l10n.t("Delete the skill “{0}”? Its run history is kept.", name),
        { modal: true },
        del,
      );
      return answer === del;
    },
  };
}

export function registerExperience(context: vscode.ExtensionContext): void {
  const report = (error: unknown, operation: string): void => void reportExtensionError(error, { operation });
  const gate = createAgentsGate(context);
  const binary = resolveHelperBinary(context.extensionPath);
  const helper = createTeachHelper({ binary, log: logLine, report });
  const provider = createExperienceHostProvider({ modelFile: gate.modelFile });
  const ops = createSkillOps(provider);
  const secrets = createSkillSecrets(context.secrets);
  const relay = createPhoneApprovalRelay({
    http: {
      create: (input) => bfApi.createApproval(context.secrets, input),
      get: (id) => bfApi.getApproval(context.secrets, id),
      resolve: (id, decision, note) => bfApi.resolveHumanRequest(context.secrets, id, decision, note),
    },
    isActive: async () => gate.phoneApprovals() && !!(await context.secrets.get(SECRET_KEY)),
    now: Date.now,
    sleep,
    report,
  });
  const runner = createSkillRunner({
    helper,
    store: ops,
    secrets,
    relay,
    clock: { now: Date.now, setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout) },
    messages: runnerMessages(),
    remember: (fact) => provider.remember(fact),
    report,
  });

  const view = new SkillsViewProvider();
  const controller = new SkillsController({
    ops,
    helper,
    runner,
    secrets,
    ui: hostUi(gate, context.secrets),
    helperAvailable: !!binary,
    labels: skillsLabels,
    post: (m) => view.post(m),
    report,
  });
  view.attach(controller);
  const scheduler = createRoutineScheduler({ enabled: gate.enabled, runner, due: () => ops.due(), report });

  // The commands hide until the helper is known to work here (statically, then by `hello`).
  const setSupported = (on: boolean) => void vscode.commands.executeCommand("setContext", SUPPORTED_KEY, on);
  setSupported(!!binary);
  const refresh = (): void => {
    if (gate.enabled() && binary) void helper.probe().then((p) => setSupported(p.supported));
    view.refresh();
  };
  if (gate.enabled()) {
    refresh();
    void runner.recoverOrphans().catch((e) => report(e, "skills:recoverOrphans"));
  }

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SkillsViewProvider.viewType, view, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.commands.registerCommand("builderforce.skills.open", () => vscode.commands.executeCommand("builderforce.skills.focus")),
    vscode.commands.registerCommand("builderforce.skills.enable", async () => {
      await gate.enable();
      refresh();
    }),
    vscode.commands.registerCommand("builderforce.skills.stop", () => runner.stop()),
    vscode.commands.registerCommand("builderforce.agents.trainPrivateModel", () => trainPrivateModel(provider, gate.modelFile())),
    gate.watch(refresh),
    { dispose: () => scheduler.dispose() },
    { dispose: () => controller.dispose() },
    { dispose: () => runner.dispose() },
    { dispose: () => helper.dispose() },
  );
}
