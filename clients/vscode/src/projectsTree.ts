import * as vscode from "vscode";
import { BfTask, DEFAULT_HIDE_DONE, getCurrentWorkspace, isDoneStatus, listTasks } from "./bfApi";
import { SECRET_KEY } from "./gateway";
import { getSelectedProject, onProjectChange } from "./projectState";

const HIDE_DONE_KEY = "builderforce.hideDoneTasks";
const CONFIG_KEY = "builderforce.projectTreeConfig";
// When-clause context key so the view/title shows the right Flat⇄Hierarchy icon.
const HIERARCHY_CTX = "builderforce.projectHierarchy";

export type ProjectGroupBy = "none" | "status" | "priority";
export type ProjectSortBy = "status" | "priority" | "title" | "key";

/** Persisted shape of the Project view's arrangement. */
interface TreeConfig {
  /** View mode: false = flat list, true = nested by epic → child tasks. */
  hierarchy: boolean;
  /** Flat-mode grouping (Hierarchy IS a grouping by parent, so it's ignored there). */
  groupBy: ProjectGroupBy;
  sortBy: ProjectSortBy;
  /** Show only these statuses; null = show all. Composes with the hide-done toggle. */
  statusFilter: string[] | null;
}

const DEFAULT_CONFIG: TreeConfig = { hierarchy: false, groupBy: "none", sortBy: "status", statusFilter: null };

type Node =
  | { kind: "workspace"; name?: string }
  | { kind: "project"; name: string }
  | { kind: "group"; label: string; groupKey: string; tasks: BfTask[] }
  | { kind: "task"; task: BfTask; hasChildren: boolean }
  | { kind: "info"; label: string; command?: string };

// Canonical ordering for status/priority sorts + grouping (unknown values sort last,
// alphabetically). Shared by the sort comparator and the group ordering (DRY).
const STATUS_ORDER = ["in_progress", "in_review", "todo", "backlog", "open", "blocked", "done"];
const PRIORITY_ORDER = ["urgent", "high", "medium", "low"];

const rank = (order: string[], v: string | undefined): number => {
  const i = order.indexOf((v ?? "").toLowerCase());
  return i === -1 ? order.length : i;
};

/** Humanize a raw status/priority key for display; localize the well-known ones. */
function humanLabel(raw: string | undefined, kind: "status" | "priority"): string {
  const v = (raw ?? "").toLowerCase();
  const t = vscode.l10n.t;
  const known: Record<string, string> =
    kind === "status"
      ? {
          in_progress: t("In progress"),
          in_review: t("In review"),
          todo: t("To do"),
          backlog: t("Backlog"),
          open: t("Open"),
          blocked: t("Blocked"),
          done: t("Done"),
        }
      : { urgent: t("Urgent"), high: t("High"), medium: t("Medium"), low: t("Low") };
  if (known[v]) return known[v];
  if (!v) return kind === "status" ? t("No status") : t("No priority");
  return v.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * The "Project" view: the working context, top-down — the workspace (tenant), then the
 * project, then its tasks. The task list is arrangeable (the toolbar drives this
 * provider): a **Flat** or **Hierarchy** (epic → child tasks) view, optional **group by**
 * status/priority (flat mode), a **sort**, and a **status filter** ("show In progress").
 * Clicking a task starts a chat session; right-click sets status. Every other panel keys
 * off the same selection. Degrades to a hint when signed out or the APIs aren't reachable.
 */
export class ProjectsTreeProvider implements vscode.TreeDataProvider<Node> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<Node | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private hideDone: boolean;
  private config: TreeConfig;
  /** Child-task lookup for the Hierarchy view, rebuilt on each root fetch (no N+1:
   *  listTasks is read-through cached in bfApi, so child lookups hit the cache). */
  private childrenByParent = new Map<number, BfTask[]>();

  constructor(private readonly ctx: vscode.ExtensionContext) {
    this.hideDone = ctx.globalState.get<boolean>(HIDE_DONE_KEY, DEFAULT_HIDE_DONE);
    this.config = { ...DEFAULT_CONFIG, ...(ctx.globalState.get<Partial<TreeConfig>>(CONFIG_KEY) ?? {}) };
    // Seed the menu when-clause contexts so the right toggle icons show on load.
    void vscode.commands.executeCommand("setContext", HIDE_DONE_KEY, this.hideDone);
    void vscode.commands.executeCommand("setContext", HIERARCHY_CTX, this.config.hierarchy);
    onProjectChange(() => this.refresh());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  /** Toggle showing/hiding done tasks (persisted; drives the view-title icon). */
  setHideDone(hide: boolean): void {
    this.hideDone = hide;
    void this.ctx.globalState.update(HIDE_DONE_KEY, hide);
    void vscode.commands.executeCommand("setContext", HIDE_DONE_KEY, hide);
    this.refresh();
  }

  private saveConfig(patch: Partial<TreeConfig>): void {
    this.config = { ...this.config, ...patch };
    void this.ctx.globalState.update(CONFIG_KEY, this.config);
    void vscode.commands.executeCommand("setContext", HIERARCHY_CTX, this.config.hierarchy);
    this.refresh();
  }

  setHierarchy(on: boolean): void {
    this.saveConfig({ hierarchy: on });
  }

  /** View-options entry points — each opens a quick-pick and persists the choice. */
  async pickGroupBy(): Promise<void> {
    const opts: { label: string; value: ProjectGroupBy }[] = [
      { label: vscode.l10n.t("None"), value: "none" },
      { label: vscode.l10n.t("Status"), value: "status" },
      { label: vscode.l10n.t("Priority"), value: "priority" },
    ];
    const pick = await vscode.window.showQuickPick(
      opts.map((o) => ({ label: o.label, value: o.value, picked: this.config.groupBy === o.value })),
      { title: vscode.l10n.t("Group tasks by") },
    );
    if (pick) this.saveConfig({ groupBy: pick.value });
  }

  async pickSortBy(): Promise<void> {
    const opts: { label: string; value: ProjectSortBy }[] = [
      { label: vscode.l10n.t("Status"), value: "status" },
      { label: vscode.l10n.t("Priority"), value: "priority" },
      { label: vscode.l10n.t("Title"), value: "title" },
      { label: vscode.l10n.t("Key"), value: "key" },
    ];
    const pick = await vscode.window.showQuickPick(
      opts.map((o) => ({ label: o.label, value: o.value, picked: this.config.sortBy === o.value })),
      { title: vscode.l10n.t("Sort tasks by") },
    );
    if (pick) this.saveConfig({ sortBy: pick.value });
  }

  /** Multi-select the statuses to show (built from the project's actual lane keys). */
  async pickStatusFilter(): Promise<void> {
    const project = getSelectedProject();
    if (!project) return;
    let tasks: BfTask[] = [];
    try {
      tasks = await listTasks(this.ctx.secrets, project.id);
    } catch {
      /* fall through to an empty picker */
    }
    const statuses = Array.from(new Set(tasks.map((t) => (t.status ?? "").toLowerCase())))
      .sort((a, b) => rank(STATUS_ORDER, a) - rank(STATUS_ORDER, b) || a.localeCompare(b));
    if (statuses.length === 0) {
      void vscode.window.showInformationMessage(vscode.l10n.t("No tasks to filter yet."));
      return;
    }
    const active = this.config.statusFilter;
    const items = statuses.map((s) => ({
      label: humanLabel(s, "status"),
      status: s,
      picked: active == null ? true : active.includes(s),
    }));
    const picked = await vscode.window.showQuickPick(items, {
      title: vscode.l10n.t("Show statuses"),
      placeHolder: vscode.l10n.t("Select the statuses to show (e.g. In progress)"),
      canPickMany: true,
    });
    if (!picked) return; // cancelled — leave the filter unchanged
    // All selected (or none) ⇒ no filter (show everything), else the chosen subset.
    const chosen = picked.map((p) => p.status);
    this.saveConfig({ statusFilter: chosen.length === 0 || chosen.length === statuses.length ? null : chosen });
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === "info") {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon("info");
      if (node.command) item.command = { command: node.command, title: node.label };
      return item;
    }
    if (node.kind === "workspace") {
      const item = new vscode.TreeItem(
        node.name ?? vscode.l10n.t("Select workspace"),
        vscode.TreeItemCollapsibleState.None,
      );
      item.description = vscode.l10n.t("switch");
      item.iconPath = new vscode.ThemeIcon("organization");
      item.contextValue = "builderforceWorkspace";
      item.tooltip = vscode.l10n.t("Switch or create a workspace");
      item.command = { command: "builderforce.createWorkspace", title: vscode.l10n.t("Switch Workspace") };
      return item;
    }
    if (node.kind === "project") {
      const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.None);
      item.description = vscode.l10n.t("change");
      item.iconPath = new vscode.ThemeIcon("folder-active");
      item.contextValue = "builderforceProject";
      item.command = { command: "builderforce.selectProject", title: vscode.l10n.t("Change Project") };
      return item;
    }
    if (node.kind === "group") {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
      item.description = String(node.tasks.length);
      item.iconPath = new vscode.ThemeIcon("list-flat");
      item.contextValue = "builderforceTaskGroup";
      return item;
    }
    const t = node.task;
    const collapsible = node.hasChildren
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None;
    const item = new vscode.TreeItem(`${t.key ? `${t.key} ` : ""}${t.title}`, collapsible);
    item.description = t.status ?? "";
    item.tooltip = t.description ?? t.title;
    item.iconPath = new vscode.ThemeIcon(t.taskType === "epic" ? "type-hierarchy" : iconForStatus(t.status));
    item.contextValue = "builderforceTask";
    item.command = { command: "builderforce.startTaskSession", title: "Start Session", arguments: [node] };
    return item;
  }

  async getChildren(element?: Node): Promise<Node[]> {
    // Expand a group header → its tasks (already sorted at build time).
    if (element?.kind === "group") return element.tasks.map((task) => this.taskNode(task));
    // Expand a task in Hierarchy view → its child tasks.
    if (element?.kind === "task") {
      if (!this.config.hierarchy) return [];
      const kids = this.childrenByParent.get(element.task.id) ?? [];
      return this.sort(kids).map((task) => this.taskNode(task));
    }
    if (element) return [];

    const signedIn = !!(await this.ctx.secrets.get(SECRET_KEY));
    if (!signedIn) {
      return [
        { kind: "info", label: "Sign in to your workspace", command: "builderforce.signIn" },
        { kind: "info", label: "Create a workspace…", command: "builderforce.createWorkspace" },
      ];
    }

    let workspaceName: string | undefined;
    try {
      workspaceName = (await getCurrentWorkspace(this.ctx.secrets))?.name;
    } catch {
      /* name unresolved (older API) — the row still switches; label falls back */
    }
    const nodes: Node[] = [{ kind: "workspace", name: workspaceName }];

    const project = getSelectedProject();
    if (!project) {
      nodes.push({ kind: "info", label: "Select or create a project…", command: "builderforce.selectProject" });
      return nodes;
    }
    nodes.push({ kind: "project", name: project.name });

    try {
      const tasks = await listTasks(this.ctx.secrets, project.id);
      if (tasks.length === 0) {
        nodes.push({ kind: "info", label: "No tasks in this project" });
        return nodes;
      }
      const visible = this.applyFilters(tasks);
      // Rebuild the parent→children map from the VISIBLE set (used by Hierarchy).
      const visibleIds = new Set(visible.map((t) => t.id));
      this.childrenByParent = new Map();
      for (const t of visible) {
        if (t.parentTaskId != null && visibleIds.has(t.parentTaskId)) {
          const arr = this.childrenByParent.get(t.parentTaskId) ?? [];
          arr.push(t);
          this.childrenByParent.set(t.parentTaskId, arr);
        }
      }

      if (visible.length === 0) {
        nodes.push({ kind: "info", label: "No tasks match the current filter", command: "builderforce.projectFilterStatus" });
        return nodes;
      }

      if (this.config.hierarchy) {
        // Top-level = no parent, or a parent hidden by the filter (so children aren't lost).
        const top = visible.filter((t) => t.parentTaskId == null || !visibleIds.has(t.parentTaskId));
        nodes.push(...this.sort(top).map((task) => this.taskNode(task)));
      } else if (this.config.groupBy === "none") {
        nodes.push(...this.sort(visible).map((task) => this.taskNode(task)));
      } else {
        nodes.push(...this.buildGroups(visible, this.config.groupBy));
      }
    } catch (e) {
      nodes.push({ kind: "info", label: `Tasks unavailable — ${(e as Error).message}`, command: "builderforce.diagnose" });
    }
    return nodes;
  }

  private taskNode(task: BfTask): Node {
    // A task is expandable only in Hierarchy view when it actually has visible children.
    const hasChildren = this.config.hierarchy && (this.childrenByParent.get(task.id)?.length ?? 0) > 0;
    return { kind: "task", task, hasChildren };
  }

  /** Hide-done toggle + status filter, composed. */
  private applyFilters(tasks: BfTask[]): BfTask[] {
    const f = this.config.statusFilter;
    return tasks.filter((t) => {
      if (this.hideDone && isDoneStatus(t.status)) return false;
      if (f && !f.includes((t.status ?? "").toLowerCase())) return false;
      return true;
    });
  }

  private sort(tasks: BfTask[]): BfTask[] {
    const by = this.config.sortBy;
    return [...tasks].sort((a, b) => {
      switch (by) {
        case "priority":
          return rank(PRIORITY_ORDER, a.priority) - rank(PRIORITY_ORDER, b.priority) || a.title.localeCompare(b.title);
        case "title":
          return a.title.localeCompare(b.title);
        case "key":
          return (a.key ?? "").localeCompare(b.key ?? "", undefined, { numeric: true });
        case "status":
        default:
          return rank(STATUS_ORDER, a.status) - rank(STATUS_ORDER, b.status) || a.title.localeCompare(b.title);
      }
    });
  }

  /** Flat-mode grouping: ordered group headers, each holding its sorted tasks. */
  private buildGroups(tasks: BfTask[], groupBy: ProjectGroupBy): Node[] {
    const order = groupBy === "priority" ? PRIORITY_ORDER : STATUS_ORDER;
    const kind = groupBy === "priority" ? "priority" : "status";
    const byKey = new Map<string, BfTask[]>();
    for (const t of tasks) {
      const key = ((groupBy === "priority" ? t.priority : t.status) ?? "").toLowerCase();
      const arr = byKey.get(key) ?? [];
      arr.push(t);
      byKey.set(key, arr);
    }
    return Array.from(byKey.entries())
      .sort(([a], [b]) => rank(order, a) - rank(order, b) || a.localeCompare(b))
      .map(([key, groupTasks]) => ({
        kind: "group" as const,
        groupKey: key,
        label: humanLabel(key, kind),
        tasks: this.sort(groupTasks),
      }));
  }
}

function iconForStatus(status?: string): string {
  switch (status) {
    case "done":
      return "pass-filled";
    case "in_progress":
      return "loading~spin";
    case "in_review":
      return "git-pull-request";
    case "blocked":
      return "error";
    default:
      return "circle-outline";
  }
}
