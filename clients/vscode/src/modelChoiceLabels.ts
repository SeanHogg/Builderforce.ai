import * as vscode from "vscode";
import { DEFAULT_MODEL_CHOICE_LABELS, type ModelChoiceLabels } from "@seanhogg/builderforce-brain-embedded";

/**
 * The model list's copy, localized once for BOTH editor surfaces that show it:
 * the composer's `/` menu in the Brain webview (shipped through `init`) and the
 * `Change model` QuickPick in the extension host.
 *
 * They render the same rows from the same builder (`buildModelItems`), so the
 * sentence that tells a user their turn is billed to their own Anthropic account
 * has to be one string, not two that drift. Everything the MENU adds around the
 * list (its heading, search, filter chips) stays in `buildLabels`.
 */
export function modelChoiceLabels(): ModelChoiceLabels {
  const t = vscode.l10n.t;
  return {
    ...DEFAULT_MODEL_CHOICE_LABELS,
    categoryAuto: t("Auto"),
    categoryByo: t("BYO"),
    categoryFree: t("Free"),
    categoryPlan: t("Plan"),
    categoryPaid: t("Paid"),
    categoryConfigured: t("Configured"),
    autoLabel: t("Auto"),
    autoDetail: t("Routed per turn: your connected accounts first, then your plan."),
    poolLabel: t("Pool"),
    poolDetail: t("Tries your connected accounts in the order configured in Account settings."),
    freeDetail: t("Free — included with BuilderForce."),
    planDetail: t("Included in your plan."),
    paidDetail: t("Premium — metered at cost + 1¢ per request."),
    // `{input}` / `{output}` are substituted with the per-1M-token rates by the
    // shared `premiumCostLabel`, so the source string keeps them literal.
    paidCostDetail: t("{input} input / {output} output per 1M tokens + $0.01 per request"),
    // The catalog string names the placeholder `{provider}`; the shared builder
    // substitutes `{vendor}`. Renamed here rather than re-translating the sentence
    // in five bundles.
    byoDetail: t("Billed to your own {provider} account — no plan credit used.").replace("{provider}", "{vendor}"),
    configuredDetail: t("Saved workspace LLM configuration"),
    evermindLabel: t("Project Evermind"),
    evermindDetail: t("Your project's own learned Evermind model."),
  };
}
