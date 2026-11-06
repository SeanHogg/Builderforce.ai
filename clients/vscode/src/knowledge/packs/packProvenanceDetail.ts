/**
 * The quick-pick `detail` line of an uploaded pack — "Reviewed by {reviewer} with {model}, {date}",
 * only the parts present, nothing when the pack carries no provenance (PRD 40, OD-3). The choice of
 * sentence is the shared `provenanceLine`; this only localizes it, one literal string per
 * combination so each is extractable and translated whole.
 */

import * as vscode from "vscode";
import { provenanceLine, type PackProvenanceParts } from "@builderforce/agent-tools/knowledge";

export function provenanceDetail(provenance: PackProvenanceParts | undefined): string | undefined {
  const line = provenanceLine(provenance, (iso) => new Date(iso).toLocaleDateString(vscode.env.language));
  if (!line) return undefined;
  const { reviewer = "", model = "", date = "" } = line.values;
  switch (line.key) {
    case "provenanceByWithOn": return vscode.l10n.t("Reviewed by {0} with {1}, {2}", reviewer, model, date);
    case "provenanceByWith": return vscode.l10n.t("Reviewed by {0} with {1}", reviewer, model);
    case "provenanceByOn": return vscode.l10n.t("Reviewed by {0}, {1}", reviewer, date);
    case "provenanceBy": return vscode.l10n.t("Reviewed by {0}", reviewer);
    case "provenanceWithOn": return vscode.l10n.t("Reviewed with {0}, {1}", model, date);
    case "provenanceWith": return vscode.l10n.t("Reviewed with {0}", model);
    case "provenanceOn": return vscode.l10n.t("Reviewed {0}", date);
  }
}
