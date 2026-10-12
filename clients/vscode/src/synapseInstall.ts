/**
 * Host-owned Synapse install UI (command palette + model QuickPick).
 *
 * PromptOptionsMenu in `@builderforce/brain-ui` is out of path for this: the
 * catalog/pull round trips are extension-host work, and the picker already
 * exists for every other on-device runtime.
 */
import * as vscode from "vscode";
import { BuilderForcePanel } from "./builderforcePanel";
import { getLocalModelsConfig } from "./gateway";
import { listLocalModels } from "./localModels";
import {
  fetchSynapseCatalog,
  pullSynapseModel,
  type SynapseCatalogItem,
} from "./synapseCatalog";

function formatBytes(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)} GB`;
  if (n >= 1_000_000) return `${Math.round(n / 1_000_000)} MB`;
  if (n >= 1000) return `${Math.round(n / 1000)} KB`;
  return `${n} B`;
}

export type SynapsePickRow = vscode.QuickPickItem & { synapseInstall?: string };

export async function runSynapseInstall(model: string): Promise<boolean> {
  const name = model.trim();
  if (!name) return false;
  const endpoint = getLocalModelsConfig().endpoints.synapse;
  if (!endpoint?.baseUrl.trim()) {
    void vscode.window.showWarningMessage(vscode.l10n.t("Synapse is not running."));
    return false;
  }
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: vscode.l10n.t("Installing {0}…", name),
      cancellable: false,
    },
    async (progress) => {
      const result = await pullSynapseModel(endpoint, name, {
        onProgress: (p) => {
          if (p.total && p.total > 0 && p.completed != null) {
            progress.report({ message: `${Math.round((p.completed / p.total) * 100)}%` });
          } else if (p.status) {
            progress.report({ message: p.status });
          }
        },
      });
      if (!result.ok) {
        void vscode.window.showErrorMessage(vscode.l10n.t("Could not install {0}: {1}", name, result.detail));
        return false;
      }
      void vscode.window.showInformationMessage(vscode.l10n.t("Installed {0}.", name));
      BuilderForcePanel.refresh();
      return true;
    },
  );
}

function catalogRows(
  items: readonly SynapseCatalogItem[],
  installed: ReadonlySet<string>,
): SynapsePickRow[] {
  const pending = items.filter((item) => !installed.has(item.id));
  if (pending.length === 0) {
    return [{ label: vscode.l10n.t("No Synapse models in the catalog.") }];
  }
  return pending.map((item) => {
    const tooBig = item.fit === false;
    return {
      label: vscode.l10n.t("$(cloud-download) Install {0}", item.id),
      detail: tooBig
        ? vscode.l10n.t("Does not fit this machine")
        : item.bytes
          ? formatBytes(item.bytes)
          : undefined,
      synapseInstall: tooBig ? undefined : item.id,
    };
  });
}

/** Rows the model picker appends so a user can install without a second command. */
export async function synapseInstallRows(): Promise<SynapsePickRow[]> {
  const config = getLocalModelsConfig();
  const endpoint = config.endpoints.synapse;
  if (!endpoint?.baseUrl.trim()) return [];
  const [catalog, localModels] = await Promise.all([fetchSynapseCatalog(endpoint), listLocalModels(config)]);
  const installed = new Set(localModels.filter((m) => m.provider === "synapse").map((m) => m.model));
  const rows: SynapsePickRow[] = [{ label: "Synapse", kind: vscode.QuickPickItemKind.Separator }];
  if (!catalog.ok) {
    rows.push({
      label: vscode.l10n.t("$(warning) Synapse catalog is unavailable."),
      detail: catalog.detail,
    });
    return rows;
  }
  rows.push(...catalogRows(catalog.items, installed));
  return rows;
}

/** Command-palette entry: pick a catalog model and pull it. */
export async function pickSynapseInstall(): Promise<void> {
  const config = getLocalModelsConfig();
  const endpoint = config.endpoints.synapse;
  if (!endpoint?.baseUrl.trim()) {
    void vscode.window.showWarningMessage(vscode.l10n.t("Synapse is not running."));
    return;
  }
  const catalog = await fetchSynapseCatalog(endpoint);
  if (!catalog.ok) {
    void vscode.window.showWarningMessage(vscode.l10n.t("Synapse catalog is unavailable."));
    return;
  }
  const installed = new Set(
    (await listLocalModels(config)).filter((m) => m.provider === "synapse").map((m) => m.model),
  );
  const rows = catalogRows(catalog.items, installed).filter((row) => row.synapseInstall);
  if (rows.length === 0) {
    void vscode.window.showInformationMessage(vscode.l10n.t("No Synapse models in the catalog."));
    return;
  }
  const pick = await vscode.window.showQuickPick(rows, {
    title: vscode.l10n.t("Install Synapse model"),
    placeHolder: vscode.l10n.t("Install Synapse model"),
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (!pick?.synapseInstall) return;
  await runSynapseInstall(pick.synapseInstall);
}
