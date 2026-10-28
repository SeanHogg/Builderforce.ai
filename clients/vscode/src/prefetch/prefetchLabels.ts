/**
 * Localized copy for the PreFetch gate (docs/design/deterministic-prefetch.md): each
 * registry row's `labelKey` (`prefetch.action.<id>` — the confirm chip, the answer row and
 * the trace say which action ran), the gate's routes (`prefetch.route.<route>`, the
 * `prefetch.decision` trace step) and the chips' own copy (`prefetch.chip.<field>` —
 * brain-ui's `PrefetchChipLabels` fields, plus each answer chip's `labelKey`). Translated
 * through `vscode.l10n` and merged into the panel's label bundle like every other string.
 */

import * as vscode from "vscode";

export function prefetchLabels(): Record<string, string> {
  const t = vscode.l10n.t;
  return {
    "prefetch.decision": t("PreFetch gate"),
    "prefetch.action.symbols.where-defined": t("Symbol lookup"),
    "prefetch.action.context.pre-search": t("Workspace pre-search"),
    "prefetch.action.memory.answer": t("Project memory"),
    "prefetch.action.diag.typecheck": t("Type check"),
    "prefetch.action.lint.check": t("Lint check"),
    "prefetch.action.lint.fix": t("Lint auto-fix"),
    "prefetch.action.dup.check": t("Duplicate code"),
    "prefetch.action.deps.cycles": t("Import cycles"),
    "prefetch.action.deadcode.check": t("Unused code"),
    "prefetch.action.arch.boundaries": t("Layer boundaries"),
    "prefetch.action.deps.audit": t("Dependency audit"),
    "prefetch.action.secrets.scan": t("Secrets scan"),
    "prefetch.action.tests.related": t("Related tests"),
    "prefetch.action.scaffold.plop": t("Plop generator"),
    "prefetch.action.scaffold.hygen": t("Hygen generator"),
    "prefetch.action.scaffold.template": t("Starter scaffold"),
    "prefetch.action.codegen.openapi": t("OpenAPI client generation"),
    "prefetch.action.codegen.prisma": t("Prisma client generation"),
    "prefetch.action.codegen.graphql": t("GraphQL code generation"),
    "prefetch.action.codemod.pattern": t("Codemod (ast-grep)"),
    "prefetch.action.format.apply": t("Format code"),
    "prefetch.action.knowledge.review-dir": t("Folder review"),
    "prefetch.action.knowledge.graph": t("Knowledge graph"),
    "prefetch.action.knowledge.ask": t("Knowledge lookup"),
    "prefetch.route.answer": t("Answered without a model"),
    "prefetch.route.prefetch": t("Facts gathered before the model"),
    "prefetch.route.llm": t("Sent to the model"),
    "prefetch.chip.confirmPrompt": t("Run {action}? It changes files in your workspace."),
    "prefetch.chip.confirm": t("Run"),
    "prefetch.chip.dismiss": t("Dismiss"),
    "prefetch.chip.aria": t("Confirm a workspace change"),
    "prefetch.chip.answeredBy": t("Answered by {action} — no model was called"),
    "prefetch.chip.answeredHint": t("A deterministic tool answered this request directly, so no model ran."),
    "prefetch.chip.nextSteps": t("Next steps"),
    "prefetch.chip.openInGraph": t("Open in graph"),
  };
}
