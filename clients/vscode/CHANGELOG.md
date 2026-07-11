# Change Log

All notable changes to the BuilderForce VS Code extension are documented here.

## [2026.7.60] — Chat work always becomes a linked ticket (every chat surface)

- **What you fix or plan in chat now lands on the board, tied to the conversation.** The chat assistant now knows which conversation it is in, so when its investigation concludes that something needs doing — a bug, a gap, a follow-up — it creates the work item and links it back to this chat, instead of only describing it. And when the assistant changes code, that change is recorded as a ticket linked to the chat (it opens in review and completes automatically once the change ships). If a turn edits code but doesn't record a ticket itself, the extension mints one for you, so an edit is never invisible or unlinked. Every item is traceable from the chat that produced it.
- **Now covers the native `@builderforce` chat too.** The native chat participant previously had no conversation of its own, so its work couldn't be linked back. Each `@builderforce` session now gets its own Brain conversation (created on the first message, reused for the rest of the session, and persisted so you can reopen it), and the same "work becomes a linked ticket" guarantee applies there as in the sidebar Brain.

## [2026.7.45] — Works on locked-down work networks

- **Fixed: the extension now reaches BuilderForce through the primary domain.** Some corporate networks whitelist `builderforce.ai` but block the `api.` subdomain, so the extension's calls to `api.builderforce.ai` were being dropped on those machines — sign-in and chat would silently fail. It now talks to the API over the same whitelisted host you already trust, at `https://builderforce.ai/gateway`, so it works behind those firewalls with no per-machine configuration. If you'd previously set a custom **BuilderForce: Base URL**, it's still honoured; clear it to pick up the new default. Self-hosted and direct-`api.` setups keep working via the same setting.

## [2026.7.43] — Answer the assistant's questions with a click

- **When the assistant needs a decision, it now asks with buttons.** Previously, when the assistant needed you to choose — who owns this initiative, which approach to take, create under project X or a new one — it buried the question in a paragraph and you had to re-type the answer, which the chat couldn't reliably interpret. Now those questions render as a clean card with clickable options (single-choice sends on click; multi-choice lets you tick several and hit Send). Your pick posts straight back as your next message, so the conversation keeps moving without ambiguity.

## [2026.7.42] — The assistant can find your code again (no more search dead-ends)

- **Fixed: code search stopped giving up early on big projects.** In a large workspace, asking the assistant to find something (a component, a function, a symbol) could come back "no matches" even when the code was right there — so it fell back to opening file after file, ballooning the conversation and never quite landing the change. The search now sweeps your project breadth-first instead of diving into the first big folder and running out of budget, so a symbol that lives deeper in the tree is actually found. When a search genuinely can't cover everything, it now says so honestly ("truncated — narrow it down") instead of claiming the term doesn't exist.
- **New: scope a search to a folder.** Code search now takes an optional path, so the assistant can look inside just `packages/brain-ui` (for example) instead of the whole repo — faster, more relevant results, and far less chat bloat on large monorepos.

## [2026.7.39] — Run diagnostics with the authority you actually have

- **Fixed: owners and managers can run diagnostics again.** Signing in from the editor used to hand you a plain-member session no matter who you were, so running a SOC 2, Architecture, Quality, or Privacy check bounced back with "You need a manager role to run diagnostics" — even when you own the workspace. Your editor session now carries the same authority you hold on the web, so the checks you're entitled to just run.

## [2026.7.38] — Meetings and Diagnostics, right in your sidebar

- **Fixed: the sidebar no longer errors on start-up.** A stale package could pop "No view is registered with id: builderforce.meetings / builderforce.diagnostics" because the new views were wired in code before the manifest declared them. The two views now ship together, so the BuilderForce panel loads clean on a fresh install — no red toasts.
- **Meetings live in the editor now.** A new **Meetings** view lists your scheduled meetings in the BuilderForce sidebar. Each one gives you **Join Here** to drop straight into the call inside VS Code, or **Join in Browser** — plus **Schedule Meeting** and a refresh right from the view's toolbar. No more tab-hopping to see what's next.
- **Run security & compliance checks without leaving your code.** A new **Diagnostics** view lets you sign in, pick a project, and run SOC 2, Architecture, Quality, and Privacy & Data-Law diagnostics on the spot — then open the full report in the editor. The checks that used to live only on the web are now one click away in the sidebar.

## [2026.7.33] — Find the right ticket to link, even with thousands of them

- **Search the ticket you want instead of scrolling forever.** The "Link ticket" picker now has a search box — start typing and it narrows to matching tickets as you go, so linking the right task, epic, spec, or roadmap item stays instant even when a project has thousands of them. When a search still has more matches than fit, it tells you how many more so you can refine.

## [2026.7.31] — Every kind of work links, and the assistant can create any of them

- **Specs and PRDs now link to a chat too.** Open a spec from the PRDs page and it's pinned to the conversation with its live status — joining tasks, epics, gaps, OKRs, initiatives, portfolios, and roadmap items. Every kind of work you plan can now be attached to any chat, from its page or the link picker.
- **Ask the assistant to create anything on your roadmap.** It can now add, update, and tick off roadmap items directly (e.g. "add a 'Billing v2' item to the Now column and mark the old one shipped"), and log a Gap as a first-class follow-up — no more leaving the editor to shape the plan. Whatever it creates shows up on your board and roadmap immediately.

## [2026.7.29] — Open an item, and the chat is already tied to it

- **Click a roadmap item, task, epic, gap, or OKR and the chat knows exactly what it's about.** Opening a work item in a chat now links that item to the conversation automatically — you see it pinned at the top of the chat with its live progress, instead of a blank "no tickets linked yet". So every chat carries the context of the item that started it, the assistant works against the right thing, and you can jump from the item to every conversation about it.
- **Roadmap items and gaps are first-class now.** They join tasks, epics, OKRs, initiatives, and portfolios as things you can attach to any chat — from the roadmap page, the board, or the link picker — so nothing you plan is left un-trackable.

## [2026.7.24] — Chats keep going, and a copied chat tells you why one stopped

- **Long chats no longer run out of room.** Big tool results (like a full task list) used to pile up until the assistant hit its limit and stopped mid-task. Now those results are trimmed to what matters as they go, and the conversation keeps only what fits — so a busy chat keeps working instead of dying after a few steps.
- **Copy a chat and see exactly what happened.** Copying a conversation now adds a short **Diagnostics** section: a plain-English "likely cause" if something went wrong, plus the tokens used, which tool returned the most data, and whether the model was swapped mid-run. Paste it into a bug report and the reason is right there.

## [2026.7.22] — Every chat knows its project, and long chats stay fast

- **The chat is labelled with the project it's about.** Open a new conversation and the panel now shows the project name at the top instead of a generic badge — so at a glance you always know which project this chat belongs to, and existing chats show their own project too.
- **Consolidate a long conversation into a clean summary.** A new **Consolidate** button sums up everything so far into one tidy recap the assistant shares back with you. From that point on the conversation carries just the summary forward — so a chat that's grown huge stays fast and focused instead of dragging its whole history along.
- **Branch off into a fresh chat without losing the thread.** The new **Fork** button takes what you've discussed, summarizes it, and opens a brand-new conversation that picks up right from that summary — perfect for splitting one long thread into a new direction while keeping the context you built up.
- **Copy a chat and get the full picture.** Copying a conversation now includes which project and model it used and the chat's name, so a shared transcript is traceable on its own — no guessing where it came from.

## [2026.7.21] — Big jobs get done, not dropped

- **Ask for a big job and it gets handed to the team, not abandoned half-done.** When you ask the assistant to do something large — like "turn every open item in my roadmap into goals, epics, and tasks" — it now does the planning right there in chat, then creates a task with the full brief and hands it to a cloud agent to carry out end-to-end, and tells you where to watch it. No more stalling partway through a long job.
- **It finds your files instead of giving up.** Ask about a document like your roadmap and the assistant now searches for it — even if the name is spelled a little differently or it lives in a subfolder — rather than saying it can't be found. And it no longer chokes on very large projects when looking around.
- **More room to finish in one go.** Everyday multi-step work now runs comfortably to completion in a single chat instead of cutting off early.

- **The chat box highlights as you type.** It lights up in BuilderForce blue while you're writing — so it's always clear where your focus is — and settles back to normal once it's empty.
- **Everything you need in one tidy toolbar.** A new **＋** menu keeps your inputs together: upload a file from your computer, pull in a file from your workspace, or let the assistant reach the web. A new **/** menu lets you dial the assistant's effort — Quick, Balanced, or Thorough — turn step-by-step thinking on or off, and jump straight to your account settings.
- **Auto mode, one tap away.** Flip Auto mode on right from the chat box to let the assistant carry out its actions without stopping to ask each time.
- **Talk instead of type.** Where your editor supports it, tap the microphone to dictate your message.
- **Switch models without leaving the chat.** The model name beside the box is now a button — click it to pick a different one.

## [2026.7.13] — Your message is never lost when a session expires

- **Fixed: a chat error you can dismiss — and a message you don't lose.** If your session expired mid-send, the chat used to show a red "Invalid or expired token" error you couldn't close, and the message you'd typed was gone. Now the error banner has a **Dismiss** button plus a one-click **Reconnect** that re-establishes your session, and the text you sent is put back in the composer so you can send it again once you're reconnected.

## [2026.7.10] — Roadmap, retros, and poker — in the editor

- **Three more pages open natively.** "Open Page…" now includes your **Roadmap** (items grouped by Now / Next / Later, with target dates and status at a glance), your **Retrospectives**, and your **Planning Poker** sessions — each opens instantly in the editor like the rest, no blank panels. Click any item to pick it up with the chat (plan a roadmap item, turn retro feedback into tasks, or review the estimates). That completes the set: Backlog, PRDs, Roadmap, Retros, and Poker are all in the editor now.

## [2026.7.9] — See goals, epics, and tasks as one tree

- **Your OKRs sit at the top of the tree.** Turn on Hierarchy view and each of the project's goals now leads the list, with the epics and tasks that deliver it nested underneath — and their sub-tasks below that. One glance shows how today's work ladders up to what you're trying to achieve, all levels and every type in one place.
- **Focus on what needs you.** A new "Needs attention" toggle in the toolbar filters the list to just the items that are blocked, past due, or gone quiet for two weeks — so as the manager you can jump straight to what's stuck without scrolling past everything that's fine. At-risk items are flagged with a ⚠ right in the list.
- **Just my work, one click.** An "Assigned to me" toggle narrows the list to the tasks you own — pair it with "Needs attention" to see exactly what's on your plate and slipping.
- **Fix a mislabeled item in two clicks.** Right-click any task or epic to change its type — turn a plain task into an epic, or promote an epic that's really a goal into a proper OKR (its child tasks come along and it starts counting toward the project's direction).

## [2026.7.7] — See your tasks your way

- **Flat or Hierarchy.** Switch the Project & Tasks list between a flat list and a hierarchy that nests each task under its epic — one click in the view's toolbar.
- **Group, sort, and filter.** Group the flat list by status or priority, sort by status/priority/title/key, and filter to just the statuses you care about (e.g. show only In progress). Your choices stick per project.

## [2026.7.6] — Auto-approve now really means it

- **Fixed: "Auto-approve" is respected the moment you tick it.** Turning it on mid-task now skips every remaining approval in that run — previously the chat could keep asking a few more times before it took effect.

## [2026.7.5] — Pick a workspace and a project, and everything follows

- **Choose who you're building for, right at the top.** The Project & Tasks list now opens with your workspace — one click to switch between the workspaces you belong to (or spin up a new one), no digging through menus. Under it sits your project, then that project's tasks: a clear top-to-bottom line from "which team" to "what's next."
- **Every panel follows the project you pick.** Select a project and your chats, your approvals to act on, and your spend all narrow to just that project — so you see what's due and what needs you for the thing you're actually working on. Pick no project and you get the full picture: every chat and every approval, each tagged with the project it belongs to, so nothing gets lost.
- **Switch projects and it all keeps up.** Change the project (or the workspace) and the whole sidebar re-points in place — chats, inbox, and insights included — with the active project shown in each header so you always know what you're looking at.

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
