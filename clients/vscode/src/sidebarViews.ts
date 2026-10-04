import * as vscode from "vscode";
import type { DiagnosticsController } from "./diagnostics";
import type { InboxQuickActionsProvider, InboxTreeProvider } from "./inboxTree";
import type { InsightsController } from "./insights";
import type { MeetingsTreeProvider } from "./meetings";
import type { ProjectContextTreeProvider } from "./projectContextTree";
import type { ProjectsTreeProvider } from "./projectsTree";
import { getSelectedProject } from "./projectState";
import { createSectionedTreeView } from "./sectionedTreeView";
import type { SessionsTreeProvider } from "./sessionsTree";

/** The existing providers each merged view is composed from. */
export interface SidebarSources {
  readonly projectContext: ProjectContextTreeProvider;
  readonly sessions: SessionsTreeProvider;
  readonly tasks: ProjectsTreeProvider;
  readonly approvals: InboxTreeProvider;
  readonly meetings: MeetingsTreeProvider;
  readonly quickActions: InboxQuickActionsProvider;
  readonly insights: InsightsController;
  readonly diagnostics: DiagnosticsController;
}

/** "Enterprise · Hired.Video": the scope every row in a view is read against. */
function scopeLine(...parts: Array<string | undefined>): string | undefined {
  const line = parts.filter(Boolean).join(" · ");
  return line || undefined;
}

/**
 * The BuilderForce sidebar's merged views. Each one composes providers that used
 * to own a view of their own, as collapsible groups:
 *   • Work   — workspace/project context, Sessions, Tasks
 *   • Inbox  — Needs you, Meetings, Quick actions (badge = requests + live meetings)
 *   • Health — Spend today, Audits
 * The view-level refresh commands live here because they belong to these views.
 */
export function registerSidebarViews(src: SidebarSources): vscode.Disposable {
  const t = vscode.l10n.t;
  return vscode.Disposable.from(
    createSectionedTreeView(
      "builderforce.work",
      [
        { id: "context", provider: src.projectContext },
        { id: "sessions", label: t("Sessions"), icon: "comment-discussion", provider: src.sessions },
        { id: "tasks", label: t("Tasks"), icon: "checklist", provider: src.tasks },
      ],
      { describe: () => scopeLine(src.projectContext.workspaceName, getSelectedProject()?.name) },
    ),
    createSectionedTreeView(
      "builderforce.inbox",
      [
        { id: "needs", label: t("Needs you"), icon: "bell", provider: src.approvals },
        {
          id: "meetings",
          label: t("Meetings"),
          icon: "device-camera-video",
          provider: src.meetings,
          empty: { label: t("No upcoming meetings"), command: "builderforce.scheduleMeeting" },
        },
        { id: "quick", label: t("Quick actions"), icon: "zap", collapsed: true, provider: src.quickActions },
      ],
      {
        badge: () => {
          const pending = src.approvals.pendingCount;
          const live = src.meetings.liveCount;
          const value = pending + live;
          return value > 0
            ? { value, tooltip: t("{0} requests need you · {1} meetings live", pending, live) }
            : undefined;
        },
      },
    ),
    createSectionedTreeView(
      "builderforce.health",
      [
        {
          id: "spend",
          label: t("Spend today"),
          icon: "graph",
          provider: src.insights.treeProvider,
          describe: () => src.insights.summary(),
          empty: { label: t("Waiting for usage data…") },
        },
        {
          id: "audits",
          label: t("Audits"),
          icon: "shield",
          provider: src.diagnostics.treeProvider,
          describe: () => src.diagnostics.summary(),
          empty: { label: t("No audits available") },
        },
      ],
      { describe: () => getSelectedProject()?.name },
    ),
    vscode.commands.registerCommand("builderforce.refreshWork", () => {
      void vscode.commands.executeCommand("builderforce.refreshSessions");
      void vscode.commands.executeCommand("builderforce.refreshProjects");
    }),
    vscode.commands.registerCommand("builderforce.refreshHealth", () => {
      void src.insights.refresh();
      void src.diagnostics.refresh();
    }),
  );
}
