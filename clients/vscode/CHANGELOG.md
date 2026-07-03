# Change Log

All notable changes to the BuilderForce VS Code extension are documented here.

## [2026.7.4] — Your backlog and specs, in the editor

- **Open Page… is back — and it works now.** The picker returns with two pages that open natively and instantly (no more blank panels): your **Backlog** (every task grouped by status, with priority at a glance — click one to start working on it with the chat) and your **PRDs & Specs** (grouped by status — click one to pick up where you left off). Both stay live as work moves and follow the project you've selected.

## [2026.7.3] — Your project's whole picture, right in the editor

- **New: Project 360.** Open a project and see its whole picture without leaving VS Code — overall health, the gaps worth closing next, and who on your team is moving the work (or idle). Every item is one click from action: open the board, hand it to the chat, or run a task. It opens instantly and stays live as work moves — built the same reliable way as the chat, so it just works.
- **Retired the pages that wouldn't open.** The old "Open Page…" picker tried to load web pages inside the editor and too often showed a blank panel. It's gone; the Board and the new Project 360 are the in-editor views, and both open natively and reliably.

## [2026.7.2] — When a page won't open, it tells you why

- **Clear diagnosis when an in-editor page won't load.** If a BuilderForce page opened via "Open Page…" doesn't appear, the BuilderForce Embed output channel now spells out the reason in plain language — the page couldn't be reached, it loaded but its code didn't run in the editor, or it started but stalled — instead of a silent "didn't render." No frontend redeploy needed to see it.

## [2026.7.1] — The chat already knows your project

- **No more "which project?"** — the chat now works on the project you've picked in the sidebar. Ask it to review your pull requests, fix errors, or list tasks and it acts on your active project straight away, instead of stopping to ask you for a project id. Switch projects and the chat follows.

## [2026.7.0] — Every page opens

- **Open Page… only lists pages that open.** The picker now shows just the views that come up in the editor — the two that couldn't (Sprints and Velocity) are gone, so nothing you pick leaves you staring at a blank panel.

## [2026.6.42] — Your team's work, in the editor

- **A Work Inbox** — a new sidebar list shows what needs you: pending approvals to act on, plus one-click starts for the jobs below. No dashboard trip.
- **Review your pull requests** — ask the agent to list your open PRs, summarize their status and CI checks, and flag what's stale or blocked.
- **Fix production errors** — the agent can now see your unresolved runtime errors and take you straight from an error to a fix in the code (works the same in the web app and the editor).
- **Open a pull request** — one action reviews your changes, commits them on a branch, pushes, and opens the PR.
- **Review changes before you commit** — open all of the agent's edits as one diff in Source Control.

## [2026.6.41] — More git, same toolset everywhere

- **Works your git history** — the agent can review `git status`/`diff`/`log`, sync the
  latest, and undo or redo its own changes, so it can check and correct what it did before
  you commit.
- The editor agent now uses the exact same coding tools as BuilderForce's cloud agents, so it
  behaves the same whether it runs in your editor or in the cloud.

## [2026.6.40] — Ships verified code: runs your tests, finds code, opens PRs

- **Verifies its own work** — after editing, the agent can run your tests, build, lint, or
  typecheck and read the results, then fix what fails before telling you it's done — instead
  of leaving you to find out it broke.
- **Commit & ship from chat** — it can run `git` and `gh` to commit, push, and open a pull
  request, so a change goes from idea to PR without leaving the editor.
- **Finds the right code fast** — searches your whole repo for what to change before editing,
  so its edits land in the right place on large projects.
- Every command runs in your workspace and asks for approval first, showing the exact command
  line before it runs.

## [2026.6.39] — Run your team's work from the editor, with full visibility

- **Run your team's work from the editor** — open, update, and dispatch projects, tasks, and
  OKRs right in chat, and follow a run's status without switching to a dashboard.
- **See exactly what the agent did** — its reasoning, each tool call with input/output, file
  edits, and errors are all visible, so you can trust and verify before applying.
- **Show it a screenshot** — paste or attach an image of a bug, error, or design and the agent
  acts on what it sees (previously a pasted image could return an empty reply).
- **Copy chat & Diagnostics** — one click copies the whole conversation for a teammate or
  support; another runs connection diagnostics.
- **Pick up anywhere** — conversations are shared with the BuilderForce web app, so you can
  start in the editor and continue in the browser.
- Editor UI is fully localized (English, 简体中文, Español, Français, Deutsch).

## [2026.6.31] — New extension id, Marketplace publish fix, refreshed brand icon

- **Renamed the extension id to `builderforce.builderforce-ai`** (was
  `builderforce.builderforce-vscode`) and the display name to **"BuilderForce.ai"** (was
  "BuilderForce"). The previous extension was removed from the Marketplace and, per
  Marketplace policy, both a removed id *and* its display name are permanently reserved and
  cannot be reused — so the extension now ships under a new id and title. Publisher
  (`builderforce`) is unchanged.
- Removed the proposed `chatSessionsProvider` API declaration from the manifest, which was
  blocking Marketplace publishing (proposed APIs cannot be shipped to stable VS Code). The
  dedicated chat-session tab was already feature-detected at runtime and no-ops on stable
  builds, so nothing changes for published users; the stable `@builderforce` chat
  participant and sidebar are unaffected.
- Ships the updated BuilderForce.ai brand icon.

## [2026.6.20] — Coding agent, codebase grounding, browser sign-in

- **In-folder agent editing** — the chat now runs an agentic tool-calling loop with
  sandboxed file tools (`read_file`, `write_file`, `edit_file`, `list_files`,
  `delete_file`) rooted at the open workspace folder. Mutating edits are gated by
  `builderforce.permissionMode` (`ask` shows Apply/Skip; `acceptEdits` auto-applies).
- **Codebase scan + knowledge summary** — first time you open a folder, the extension
  scans it and writes `.builderforce/architecture.md` + a grounding summary (cached by a
  file-tree version token; re-run with **Rescan Codebase**). The summary is injected as
  agent context so it doesn't misfire. A "● grounded" chip shows when active.
- **Browser device-code sign-in** — `Sign In` now runs the RFC 8628 browser flow against
  `/api/auth/device/*`, falling back to paste-key when those endpoints aren't reachable.
  Registered as a proper VS Code authentication provider (shows in the Accounts menu).
- **Real mascot icon** (agentHost brand mark) for the activity bar + gallery.

## [2026.6.17] — Initial publishing surface

- Sidebar **Chat** webview (Activity Bar container) with streaming responses from the
  BuilderForce gateway (`/llm/v1/chat/completions`).
- **Sign in / Sign out** via SecretStorage (OS keychain). v0 uses paste-key; browser
  device-code login lands once the `/api/auth/device/*` endpoints deploy.
- **Pick model** from the live gateway pool (`/llm/v1/models`, cached).
- **New chat**, **Open settings** commands; configurable `baseUrl`, `defaultModel`,
  `permissionMode`.
- Dual-registry publish pipeline (VS Code Marketplace + Open VSX).
