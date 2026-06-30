# Change Log

All notable changes to the BuilderForce VS Code extension are documented here.

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
