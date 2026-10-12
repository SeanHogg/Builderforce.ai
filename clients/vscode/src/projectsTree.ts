import * as vscode from "vscode";
import { isClosedTask } from "@builderforce/agent-loop";
import { BfObjective, BfTask, getCurrentUserId, listProjectObjectives, listTasks } from "./bfApi";
import { SECRET_KEY } from "./gateway";
import { getSelectedProject, onProjectChange } from "./projectState";
import { attentionApprovalId, attentionFor, attentionIcon, attentionDescriptionPrefix } from "./attention";
import {
  PRIORITY_ORDER,
  STATUS_ORDER,
  humanLabel,
  rank,
  taskNeedsAttention,
  taskRowLabel,
  taskStatusIcon,
} from "./taskTreeShared";

const CONFIG_KEY = "builderforce.projectTreeConfig";
// When-clause context key so the view/title shows the right Flat⇄Hierarchy icon.
const HIERARCHY_CTX = "builderforce.projectHierarchy";
// When-clause context key for the "Needs attention" filter toggle icon.
const ATTENTION_CTX = "builderforce.projectNeedsAttention";
// When-clause context key for the "Assigned to me" filter toggle icon.
const MINE_CTX = "builderforce.projectAssignedToMe";
export type ProjectGroupBy = "none" | "status" | "priority";
export type ProjectSortBy = "status" | "priority" | "title" | "key";

/** Persisted shape of the Project view's arrangement. */
interface TreeConfig {
  /** View mode: false = flat list, true = nested by epic → child tasks. */
  hierarchy: boolean;
  /** Flat-mode grouping (Hierarchy IS a grouping by parent, so it's ignored there). */
  groupBy: ProjectGroupBy;
  sortBy: ProjectSortBy;
  /** Show only these statuses; null = show all. Applies within open work. */
  statusFilter: string[] | null;
  /** Show only tickets that need attention (blocked / overdue / stale). */
  needsAttention: boolean;
  /** Show only tickets assigned to the signed-in user. */
  assignedToMe: boolean;
}

const DEFAULT_CONFIG: TreeConfig = { hierarchy: false, groupBy: "none", sortBy: "status", statusFilter: null, needsAttention: false, assignedToMe: false };

type Node =
  | { kind: "group"; label: string; groupKey: string; tasks: BfTask[] }
  | { kind: "objective"; objective: BfObjective; tasks: BfTask[] }
  | { kind: "task"; task: BfTask; hasChildren: boolean }
  | { kind: "info"; label: string; command?: string };

/**
 * The Tasks section of the Work view: the selected project's tasks (the workspace and
 * project rows above it are `ProjectContextTreeProvider`). The list is arrangeable (the toolbar drives this
 * provider): a **Flat** or **Hierarchy** (epic → child tasks) view, optional **group by**
 * status/priority (flat mode), a **sort**, and a **status filter** ("show In progress").
 * It lists OPEN work only — done, cancelled and archived tickets live in the Closed
 * section below (`ClosedTasksTreeProvider`). Clicking a task starts a chat session;
 * the row actions set status, archive or delete. Every other panel keys
 * off the same selection. Degrades to a hint when signed out or the APIs aren't reachable.
 */
export class ProjectsTreeProvider implements vscode.TreeDataProvider<Node> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<Node | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private config: TreeConfig;
  /** Child-task lookup for the Hierarchy view, rebuilt on each root fetch (no N+1:
   *  listTasks is read-through cached in bfApi, so child lookups hit the cache). */
  private childrenByParent = new Map<number, BfTask[]>();
  /** The project's OKR objectives (top tier of the Hierarchy view), fetched with the
   *  task roots. Empty in Flat mode / when the rollup isn't reachable. */
  private objectives: BfObjective[] = [];
  /** The signed-in user's id (for the "Assigned to me" filter); null = unresolved,
   *  so the filter degrades to a no-op rather than hiding everything. */
  private currentUserId: string | null = null;

  constructor(private readonly ctx: vscode.ExtensionContext) {
    this.config = { ...DEFAULT_CONFIG, ...(ctx.globalState.get<Partial<TreeConfig>>(CONFIG_KEY) ?? {}) };
    // Seed the menu when-clause contexts so the right toggle icons show on load.
    void vscode.commands.executeCommand("setContext", HIERARCHY_CTX, this.config.hierarchy);
    void vscode.commands.executeCommand("setContext", ATTENTION_CTX, this.config.needsAttention);
    void vscode.commands.executeCommand("setContext", MINE_CTX, this.config.assignedToMe);
    onProjectChange(() => this.refresh());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  private saveConfig(patch: Partial<TreeConfig>): void {
    this.config = { ...this.config, ...patch };
    void this.ctx.globalState.update(CONFIG_KEY, this.config);
    void vscode.commands.executeCommand("setContext", HIERARCHY_CTX, this.config.hierarchy);
    void vscode.commands.executeCommand("setContext", ATTENTION_CTX, this.config.needsAttention);
    void vscode.commands.executeCommand("setContext", MINE_CTX, this.config.assignedToMe);
    this.refresh();
  }

  setHierarchy(on: boolean): void {
    this.saveConfig({ hierarchy: on });
  }

  /** Toggle the "Needs attention" filter (blocked / overdue / stale). */
  setNeedsAttention(on: boolean): void {
    this.saveConfig({ needsAttention: on });
  }

  /** Toggle the "Assigned to me" filter (tasks owned by the signed-in user). */
  setAssignedToMe(on: boolean): void {
    this.saveConfig({ assignedToMe: on });
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

  /** Multi-select the statuses to show (built from the open tickets' actual lane keys). */
  async pickStatusFilter(): Promise<void> {
    const project = getSelectedProject();
    if (!project) return;
    let tasks: BfTask[] = [];
    try {
      tasks = await listTasks(this.ctx.secrets, project.id);
    } catch {
      /* fall through to an empty picker */
    }
    const statuses = Array.from(new Set(tasks.filter((t) => !isClosedTask(t)).map((t) => (t.status ?? "").toLowerCase())))
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
    if (node.kind === "group") {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
      item.description = String(node.tasks.length);
      item.iconPath = new vscode.ThemeIcon("list-flat");
      item.contextValue = "builderforceTaskGroup";
      return item;
    }
    if (node.kind === "objective") {
      const o = node.objective;
      const item = new vscode.TreeItem(o.title, vscode.TreeItemCollapsibleState.Expanded);
      item.description = `${vscode.l10n.t("OKR")} · ${Math.round(o.progress)}%`;
      item.tooltip = vscode.l10n.t("OKR objective — {0}% complete", Math.round(o.progress));
      item.iconPath = new vscode.ThemeIcon("target");
      item.contextValue = "builderforceObjective";
      return item;
    }
    const t = node.task;
    const collapsible = node.hasChildren
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None;
    const item = new vscode.TreeItem(taskRowLabel(t), collapsible);
    const attention = taskNeedsAttention(t, Date.now());
    // Live execution state (running / awaiting a human answer), layered over the
    // stale/blocked "⚠" risk badge and the status label. A pending question ("❓")
    // is the most urgent signal, so it leads.
    const live = attentionFor("task", t.id);
    const livePrefix = live ? attentionDescriptionPrefix(live) : "";
    item.description = `${livePrefix}${attention ? "⚠ " : ""}${t.status ?? ""}`;
    item.tooltip = t.description ?? t.title;
    item.iconPath = live ? attentionIcon(live) : taskStatusIcon(t);
    item.contextValue = "builderforceTask";
    // A ticket whose agent is waiting on a human answer deep-links straight to that
    // question (the same review flow the Inbox and the palette use) instead of
    // starting yet another session on top of the one that is blocked.
    const approvalId = live === "awaiting_input" ? attentionApprovalId("task", t.id) : undefined;
    item.command = approvalId
      ? { command: "builderforce.humanRequests", title: vscode.l10n.t("Answer the agent's question"), arguments: [approvalId] }
      : { command: "builderforce.startTaskSession", title: "Start Session", arguments: [node] };
    return item;
  }

  async getChildren(element?: Node): Promise<Node[]> {
    // Expand a group header → its tasks (already sorted at build time).
    if (element?.kind === "group") return element.tasks.map((task) => this.taskNode(task));
    // Expand an OKR objective → the board items that deliver it (its top tier).
    if (element?.kind === "objective") return this.sort(element.tasks).map((task) => this.taskNode(task));
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
        { kind: "info", label: vscode.l10n.t("Sign in to your workspace"), command: "builderforce.signIn" },
        { kind: "info", label: vscode.l10n.t("Create a workspace…"), command: "builderforce.createWorkspace" },
      ];
    }

    const project = getSelectedProject();
    if (!project) {
      return [{ kind: "info", label: vscode.l10n.t("Select or create a project…"), command: "builderforce.selectProject" }];
    }
    const nodes: Node[] = [];

    try {
      // In Hierarchy mode, also load the project's OKR objectives (the top tier); when
      // the "assigned to me" filter is on, resolve the signed-in user. All parallel;
      // tasks + objectives are read-through cached, the user id is cached for the session.
      const [tasks, objectives, userId] = await Promise.all([
        listTasks(this.ctx.secrets, project.id),
        this.config.hierarchy ? listProjectObjectives(this.ctx.secrets, project.id) : Promise.resolve([] as BfObjective[]),
        this.config.assignedToMe ? getCurrentUserId(this.ctx.secrets) : Promise.resolve(null),
      ]);
      this.objectives = objectives;
      this.currentUserId = userId;
      if (tasks.length === 0 && objectives.length === 0) {
        nodes.push({ kind: "info", label: vscode.l10n.t("No tasks in this project") });
        return nodes;
      }
      if (objectives.length === 0 && tasks.every(isClosedTask)) {
        nodes.push({ kind: "info", label: vscode.l10n.t("No open tasks — finished work is under Closed") });
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

      // Nothing to show — unless Hierarchy mode still has objectives to render.
      if (visible.length === 0 && !(this.config.hierarchy && this.objectives.length > 0)) {
        nodes.push({ kind: "info", label: vscode.l10n.t("No tasks match the current filter"), command: "builderforce.projectFilterStatus" });
        return nodes;
      }

      if (this.config.hierarchy) {
        // Top-level = no parent, or a parent hidden by the filter (so children aren't lost).
        const top = visible.filter((t) => t.parentTaskId == null || !visibleIds.has(t.parentTaskId));
        // Top tier: the project's OKR objectives, each owning the top-level board items
        // it links to (which then nest their own children below). A task claimed by an
        // objective isn't repeated in the loose list — so every level + type shows once.
        const byId = new Map(top.map((t) => [t.id, t]));
        const claimed = new Set<number>();
        const objectiveNodes: Node[] = [];
        for (const o of this.objectives) {
          const owned = o.linkedTaskIds
            .map((tid) => byId.get(tid))
            .filter((t): t is BfTask => t != null && !claimed.has(t.id));
          owned.forEach((t) => claimed.add(t.id));
          // Show the objective even with no visible owned items — it's still a goal.
          objectiveNodes.push({ kind: "objective", objective: o, tasks: owned });
        }
        nodes.push(...objectiveNodes);
        const loose = top.filter((t) => !claimed.has(t.id));
        nodes.push(...this.sort(loose).map((task) => this.taskNode(task)));
      } else if (this.config.groupBy === "none") {
        nodes.push(...this.sort(visible).map((task) => this.taskNode(task)));
      } else {
        nodes.push(...this.buildGroups(visible, this.config.groupBy));
      }
    } catch (e) {
      nodes.push({ kind: "info", label: vscode.l10n.t("Tasks unavailable — {0}", (e as Error).message), command: "builderforce.diagnose" });
    }
    return nodes;
  }

  private taskNode(task: BfTask): Node {
    // A task is expandable only in Hierarchy view when it actually has visible children.
    const hasChildren = this.config.hierarchy && (this.childrenByParent.get(task.id)?.length ?? 0) > 0;
    return { kind: "task", task, hasChildren };
  }

  /** Open work only, then the status filter + "needs attention" + "assigned to me", composed. */
  private applyFilters(tasks: BfTask[]): BfTask[] {
    const f = this.config.statusFilter;
    const now = Date.now();
    // Only enforce "assigned to me" once the user id is known — otherwise (older API)
    // it degrades to a no-op instead of hiding the whole list.
    const mine = this.config.assignedToMe && this.currentUserId ? this.currentUserId : null;
    return tasks.filter((t) => {
      if (isClosedTask(t)) return false;
      if (f && !f.includes((t.status ?? "").toLowerCase())) return false;
      if (this.config.needsAttention && !taskNeedsAttention(t, now)) return false;
      if (mine && t.assignedUserId !== mine) return false;
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
