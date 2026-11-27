import * as vscode from "vscode";

/**
 * The settings behind self-directed agents, and the consent in front of them.
 *
 * `builderforce.agents.enabled` is OFF by default. Turning it on, in the view's button or
 * straight in Settings, asks once whether the person wants Synapse to drive their desktop;
 * a yes stores `consentedAt` in global state, a no puts the setting back. Everything that
 * acts (the runner, the scheduler) asks `enabled()`, which needs BOTH the setting and the
 * stored consent, so a hand-edited settings.json cannot skip the prompt.
 */

const CONSENT_KEY = "builderforce.agents.consentedAt";

export interface AgentsGate {
  /** The setting is on AND consent was given. */
  enabled(): boolean;
  phoneApprovals(): boolean;
  /** The configured private model file, or undefined. */
  modelFile(): string | undefined;
  /** Ask for consent if it was never given, then turn the setting on. */
  enable(): Promise<void>;
  setPhoneApprovals(on: boolean): Promise<void>;
  /** Watches Settings edits: a flip to on without consent is asked about, a refusal reverts it. */
  watch(onChange: () => void): vscode.Disposable;
}

const cfg = () => vscode.workspace.getConfiguration("builderforce.agents");

export function createAgentsGate(ctx: Pick<vscode.ExtensionContext, "globalState">): AgentsGate {
  const consented = (): boolean => !!ctx.globalState.get<string>(CONSENT_KEY);

  /** True when consent exists or was just given. */
  async function ensureConsent(): Promise<boolean> {
    if (consented()) return true;
    const allow = vscode.l10n.t("Allow");
    const answer = await vscode.window.showWarningMessage(
      vscode.l10n.t("Let Synapse operate this computer?"),
      {
        modal: true,
        detail: vscode.l10n.t(
          "Self-directed agents click and type in your apps for you, replaying skills you taught them. A run makes no model call. You can stop it at any time, and steps that cannot be undone ask you first. Turn this on only if you want that.",
        ),
      },
      allow,
    );
    if (answer !== allow) return false;
    await ctx.globalState.update(CONSENT_KEY, new Date().toISOString());
    return true;
  }

  return {
    enabled: () => cfg().get<boolean>("enabled", false) && consented(),
    phoneApprovals: () => cfg().get<boolean>("phoneApprovals", false),
    modelFile: () => cfg().get<string>("modelFile", "").trim() || undefined,
    async enable() {
      if (await ensureConsent()) await cfg().update("enabled", true, vscode.ConfigurationTarget.Global);
    },
    async setPhoneApprovals(on) {
      await cfg().update("phoneApprovals", on, vscode.ConfigurationTarget.Global);
    },
    watch(onChange) {
      return vscode.workspace.onDidChangeConfiguration(async (e) => {
        if (!e.affectsConfiguration("builderforce.agents")) return;
        if (cfg().get<boolean>("enabled", false) && !(await ensureConsent())) {
          await cfg().update("enabled", false, vscode.ConfigurationTarget.Global);
        }
        onChange();
      });
    },
  };
}
