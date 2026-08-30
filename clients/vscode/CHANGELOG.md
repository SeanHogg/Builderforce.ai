# Change Log

All notable changes to the BuilderForce VS Code extension are documented here.

## [2026.8.137] — A local chat works with nobody signed in

- **Picking a model on this machine and not signing in used to give you a chat that could not send.** The panel opened, you typed, and the message failed — before the model on your machine was ever called. The reason had nothing to do with your runtime: a chat is saved as you go, and saving needs an account, so the very first step of the turn was refused and everything after it never ran. A signed-out on-device chat now keeps its conversation in the panel itself, and the turn reaches your hardware as it should.
- **That conversation lives in the panel and nowhere else.** It is not queued, not uploaded later, and not in your BuilderForce history — closing the panel ends it. Sign in and chats are saved to your account again, exactly as before. Summarizing a chat still needs an account, and now says so instead of failing quietly.

## [2026.8.136] — Saying plainly where a local turn’s words go

- **We were overstating what stays on your machine, and now we don’t.** Both the Local Models setting and the 2026.8.135 release note said a local turn needs no BuilderForce account and never reaches our gateway. The inference genuinely doesn’t — your prompt, your code and the reply are exchanged only with the runtime on your device. But the sidebar chat still saves its transcript to your account exactly as it always has, because that is what makes it the same conversation in the web app. If you picked a model on this machine expecting the text to stay here as well, it did not. Corrected in the settings UI, the release notes and the extension page, in every language we ship.
- **The extension page now tells you how to set this up.** It described a product that only talks to our gateway. It now names both runtimes, tells you how to start each one and on which address, walks through enabling the setting and picking a model, and spells out what does and does not leave your machine.
- **Two translation defects went with it.** The German setting called a conversational turn a *Zug* — a train, or a move in chess — and the French text had lost its apostrophes.

## [2026.8.135] — Your own machine can answer now

- **The models on your own computer show up in the model picker.** Turn on **BuilderForce › Local Models: Enabled** and everything your Ollama install has pulled, plus whatever your FreeToken engine is serving, appears under **On this device** beside the rest. Pick one and the whole turn runs on your hardware — the same tools, the same edits, the same approvals as any other chat.
- **Every AI surface honours the choice, not just one of them.** The chat panel, the `@builderforce` participant and the workspace scan all run on the model you picked. They used to answer that question separately — the scan in particular read its own setting, so pinning a local model left it quietly summarizing your repo through the gateway on a different model entirely. There is now one place that decides where a turn runs, and all three ask it.
- **The chat panel reaches your machine through the extension.** A webview cannot open a plain-HTTP connection to `localhost`, so its turns are performed by the extension host and streamed back — which also means your runtime does not have to be reconfigured to accept the editor as an origin. Only the model endpoints you have configured can be reached this way.
- **The inference never leaves your machine — your transcript still does.** Your prompt, the code context gathered from your repo and the model's reply are exchanged only with the runtime on your device: nothing reaches the BuilderForce gateway, nothing is spent from your plan, and it keeps working with the network down. The sidebar chat still saves its conversation to your account exactly as it always has — that is what makes it the same chat in the web app — so the text of a local chat is stored server-side like any other. The `@builderforce` participant and the workspace scan need no account at all, and store nothing while you are signed out.
- **Being on a plan without model choice no longer hides them.** The picker used to answer "model choice needs a paid plan" and stop there. That is a statement about what our gateway will serve, and it has nothing to say about hardware you already own — so the models on this machine are offered either way.
- **Point the settings wherever your runtimes actually live.** Ollama defaults to `http://127.0.0.1:11434` and FreeToken to `http://127.0.0.1:1919`, and both accept either the bare address or the `/v1` form that most documentation shows.

## [2026.8.133] — When something goes wrong in the editor, someone can actually find out why

- **An error in the extension used to end with you.** It was written to the BuilderForce output panel and nowhere else, so unless you thought to open that panel, copy it out and send it, nobody could see what had happened. Turn on **BuilderForce: Report Errors** in settings and the errors the extension catches are filed against your selected project, in the same Quality feed as everything else your workspace already tracks.
- **Off by default, and it stays that way until you say otherwise.** With the setting off, nothing about an error leaves your machine — the output panel is still the complete record. Nothing new to sign in with either: it uses the account you are already signed in with.
- **The messages you see when a command fails now leave a trace.** "Could not load projects", "could not rename chat", "could not resolve approval" and the rest used to be shown and forgotten; each one is now written to the output panel too, and filed if you have reporting on.

## [2026.8.129] — The extension starts again, and Copy diagnostics tells you when it didn't work

- **The extension had stopped activating at all.** Since 2026.7.126 the bundle threw before a single line of our code ran, which kills every command, view and panel and leaves nothing behind but one notification you may already have dismissed. Fixed at the bundler, and now caught before packaging: a new test suite launches a real VS Code, activates the extension in it, checks that every command in the manifest is genuinely registered, that every view resolves, and that the chat webview actually boots and talks back to the editor.
- **"Copy chat diagnostics" now says when it fails.** It used to swallow the error completely — no message, nothing on the clipboard, a click indistinguishable from a dead button. It now shows a warning on the button and puts the reason in the chat.
- **A stalled connection can no longer leave that copy hanging forever.** The version probe it makes is bounded; if the check is slow, the report is built without it instead of waiting.
- **The report stops answering the same question two different ways.** It used to print the *maximum* number of tools the model could have been offered per turn, right above the number it was *actually* offered. It now prints only what really happened — and says so plainly when nothing has been measured yet.
- **The headless probe (`pnpm probe`) now produces the same report as the Copy button**, not one missing four fields.

## [2026.7.126] — You run on Builderforce, and you can now say whether it was any good

- **Your chat says what you're actually on: "Builderforce Free" or "Builderforce PRO".** It used to print whichever upstream model the router happened to reach for that turn — a name that changes between turns, that you have no way to choose on a routed plan, and that sat right beside a model list the plan would not let you open. The plan you bought is the answer to "what am I running on", so that is what it says. Connect your own provider account, or move to a paid plan, and every real model name comes back — because then the choice is genuinely yours.
- **Every reply now has a thumbs up and a thumbs down.** They already existed on the web; the editor had none, so the place a lot of real work happens could not tell us anything about how it went.
- **Your rating now counts for something.** Each press is recorded against the model that answered you and the tool it used, so the router learns which model is genuinely better at which kind of work and picks it next time. Press the same thumb again to take it back.

## [2026.7.119] — One composer, one menu — the editor and the web app now match

- **Memory, Consolidate and Fork have moved into the `/` menu.** They used to be three permanent pills in the composer's button row, inert for most of a chat's life, sitting between the mode controls and Send — on a narrow side panel they crowded out the send button itself. In the menu each one has room to say what it actually does, and the two that need a real conversation behind them now explain *why* they are unavailable instead of just greying out.
- **Memory no longer disappears when a chat has no project behind it.** It used to vanish from the row entirely, which reads as a bug; now it stays put and tells you to link the chat to a project first.
- **The editor composer and the web composer are now the same control**, top to bottom: same `/` menu contents, same order, same plan chip beside the send button. A change to either one can no longer leave the other behind.

## [2026.7.117] — Change model shows the same list wherever you open it

- **The Sessions-view / command-palette "Change model" picker now offers exactly what the composer's `/` menu does** — same rows, same order (cheapest first: Free → Plan → Paid → your own connected accounts → your saved LLM configs), and the same one-line answer to who gets billed for each. The two pickers used to be built separately, so they grouped models differently, named the same connected provider differently, and worded "who pays" differently while reading the same account. Both are now rendered from one list.
- **The picker is now translated** (Chinese, Spanish, French, German), including the "add a card" / "upgrade" rows when premium is locked. It used to be English-only.

## [2026.7.115] — Pick your model from the composer, without leaving the chat

- **The model now lives in the `/` menu, next to Effort and Thinking.** The composer used to carry a separate chip that only told you the model's name; changing it threw you into a VS Code quick-pick, and the panel could never show you what was actually on offer. Now the `/` control names the model in use right on the button, and opening it gives you the full list — searchable, filtered by who pays (Free, Plan, Paid, BYO, your saved LLM configs) — with the funding line on every row, so you can see that a pick is billed to your own connected account rather than your plan allowance before you make it. The old chip is gone; **Change model** remains in the Sessions view overflow and the command palette.
- **"Auto" now tells you what auto actually chose.** Previously an auto-routed chat just said "Auto" — it never named the model the gateway resolved for it, including a project's own Evermind model, which was reported as a metered premium model it is not.
- **The `/` menu is now the same control on the web and in the editor**, so a change to either one can no longer leave the other behind.

## [2026.7.109] — The Evermind panel is now tabbed, and you can send its diagnostics to someone

- **The Evermind panel's four jobs are now four tabs — Teach, Test, Check and Maintain.** They used to be stacked one under the other, which turned the sidebar into a scroll marathon: "Replace the model" sat a page and a half below the state it was meant to repair. Each tab is now one job, and the things that are always true — the version, what it has learned, whether it is serving replies, and any quarantine warning — stay pinned above the tabs, so you can never replace a model without seeing why it stopped working. Arrow keys move between tabs.
- **New: Copy diagnostics.** When the model produces nonsense there was no way to hand the evidence to anyone — a screenshot loses the exact output, which is the whole point. One button (in the panel header, and again under Maintain) copies the full picture as text you can paste to support or an AI assistant: the model's state, every Evermind under the project, the last test-bench run *with its raw output verbatim* and the reason it was refused, the last knowledge check, and the tail of the learn log. It works even when the panel failed to load — that failure is often exactly what needs sending.
- **A failed readiness check and outstanding knowledge findings now follow you between tabs**, marked on the tab itself, and your results stay put when you switch away and back — so a knowledge check you paid frontier tokens for is never thrown away by a tab click.

## [2026.7.67] — Keep typing while the assistant works — your follow-ups now wait their turn

- **You no longer have to sit on your hands while a run is going.** Previously, once the assistant started working the composer went read-only — anything you typed was ignored until it finished, so a follow-up thought had to wait (and was easy to lose). Now you can keep composing and send while a run is in flight: your message joins a queue and goes out automatically the moment the current run finishes. Queue several and they send one at a time, each as its own turn, so you can line up "then do X, then check Y" without babysitting the run. Queued messages show as removable chips above the box, so you can see exactly what's pending and cancel anything you change your mind about before it sends.

## [2026.7.65] — Your chats now actually train the project's model

- **Fixed: conversations that showed "Learning · Connected" weren't teaching the model anything.** The Evermind panel could say a chat was connected and learning while, under the hood, that conversation wasn't tied to a project — and the model only learns from project conversations. So the counter never moved no matter how much you discussed. Now, when you have a project open, an unscoped chat is automatically attached to it, so what you work through in chat genuinely trains the project's model (the "Last learned" and queued counts move as you'd expect). Existing older chats self-heal the next time you open them with a project selected.

## [2026.7.62] — Open any item the chat created, and it stays linked automatically

- **Every task, epic, OKR, or spec the chat creates is now one click from its board card.** The linked-work strip under the chat header now shows each item as a clickable "Open" link (with a ↗ button) — click it to jump straight to the board it lives on. No more hunting for the thing the assistant just made.
- **Items the chat creates now link back to the conversation on their own.** Previously, when the assistant created work through its tools, the link back to the chat depended on it remembering a follow-up step — so items sometimes landed on the board orphaned from the conversation that produced them. Now every item the chat creates is tied to that conversation automatically, so the "who asked for this and why" trail is always intact.
- **Fixed: the assistant no longer runs out of room mid-task on projects with many specs.** Listing your PRDs pulled in every document's full text at once, which could fill the assistant's working memory and leave a multi-step job (like re-linking objectives to epics) half-finished. It now pulls a lightweight index and reads a document in full only when it needs it, so longer planning sessions finish what they start.

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
