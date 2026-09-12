# Change Log

All notable changes to the BuilderForce VS Code extension are documented here.

## [2026.9.45] — The agent reviews its own change, ships it, and closes the ticket

- **A change the agent makes in your editor now reaches `done`, not 75%.** Every edit opens a ticket in review — and in the extension there was nobody to do that review: no other agent can reach your working tree, and the agent had been told the "default route" was a pull request, and to push `main` only if you said so. So it edited, reported, and stopped, and its tickets sat in review indefinitely with the change uncommitted on disk. In a local session the agent is now told what is true: it IS the reviewer. It verifies the change, reads its own diff and fixes what it finds, records that review on the ticket, then commits exactly the files it changed and pushes — each step still shows you the approval prompt, so your approval is the review of its review. When the push lands on `main`, the ticket closes itself. Ask for a pull request or a branch instead and it does that; tell it not to commit and it leaves the change alone.
- **A turn that edits and stops is sent back to finish.** If the agent changes code and ends its turn without even trying to commit, the run hands it back once with the ship steps rather than accepting "I fixed it" with nothing landed. A declined approval or a failed push is reported, not retried.
- **A ticket only closes for the change that actually shipped.** The check that closes a ticket after a push could read an EARLIER turn's push in the same chat and close a later ticket whose change was still uncommitted. It now looks only at the current turn, requires the files that turn changed to be committed, and reads where the push landed straight from the push itself — including a push aimed at one checkout of a multi-repo workspace.

## [2026.9.44] — Your say is final, and a long job is allowed to be long

- **When you tell the agent to work, it works.** Directing an agent from the editor — "assign this to the agents, finish it, merge and push" — could come back `manager role required` from your own workspace, or "the dispatcher gave no reason". The first was the editor's sign-in credential being treated as an anonymous developer on the server, whatever your actual role; every platform action the chat took on your behalf ran as that stranger. It now runs as you — your id, your role — so the workspace answers its owner as its owner. The second was a thrown error being swallowed on the way back; the real reason now arrives verbatim. And a person's dispatch is the approval every governance gate was waiting for: an unstaffed lane, a managed stage with no bound role, a human gate, a tripped failure breaker — all of them step aside for a run recorded under your name, which does the work but cannot advance the ticket past a sign-off it did not earn. Only a billing allowance still says no, and says why.
- **No more "reached its tool budget".** A turn used to stop at a fixed number of tool calls — 40 in the chat participant, 25 in the panel — and a review of forty ticket branches, or a rename across a repository, was cut off mid-task for no reason but its length. The ceiling is gone on every surface, including cloud agents. What stops a run now is the thing the ceiling was a proxy for: its tool calls FAILING, five in a row, after which it is made to answer in prose with what kept failing and what it needs. A run that is working is left to work; Stop is still yours.


## [2026.9.30] — The prompt cache pays out on a tool loop, and search finds the ripgrep VS Code ships

- **The prompt cache now actually hits on a tool loop.** Anthropic caches the request prefix — tools first, then the system prompt, then the conversation — and the gateway has marked the tools and system blocks for months. Two things kept the cache from paying out. The advertised tool list was re-ordered whenever the run called a tool for the first time (the "already used" pass moved it ahead of its neighbours), and a re-ordered tools block invalidates everything cached behind it, so the ~13k-token prefix was re-billed at full price on most turns. The order is now the catalog's own, whichever reason a tool was kept. And nothing marked the conversation itself, so the growing transcript — 24k tokens by the end of a long run — was re-sent at full price every turn; the latest turn now carries the breakpoint, so each turn reads the previous one's prefix at a tenth of the price.
- **Compacting the transcript no longer costs a frontier-model answer.** The memory note the run writes when its history outgrows the window was requested with the run's full output ceiling and, on a thinking model, its reasoning depth. It is a utility call: bounded to a short answer with thinking off.
- **`search_code` finds the ripgrep that current VS Code builds actually ship.** 2026.9.23 looked for it at the two paths older builds used and, on a current install, found neither — so the search silently fell back to the bounded walk it was meant to replace, unless a `rg` happened to be on your PATH. The `ripgrep-universal` layout current builds use is probed first.

## [2026.9.23] — The agent remembers what it read, searches the whole workspace, and its runs train the project Evermind

- **A re-read no longer answers with a pointer to text the model can no longer see.** When a run's transcript grew past the context budget, the older tool results were compressed into a memory note — but the guard that stops the same file being read twice kept saying "the result is already in the conversation above". It was not, any more. The model read that as "I do not have the file", asked again, got the same stub, and went round: a real run (chat #101) re-requested one file five times, spent half its 44 calls on ground it had already covered, and ended without making the change it was asked for. The run now keeps what each read returned and, once that result has been compressed away, re-serves it from memory — no disk read, no stub that lies — and tells the model to act on it.
- **`search_code` searches the whole workspace, and a file scope searches that file.** Two false "not found"s were hiding in the search: pointing it at a single file made it report the term "not referenced there" (it tried to list the file as a directory and swallowed the error — it said `BfBrainChat` was absent from the file that declares it, four times), and an unscoped search on a multi-checkout workspace gave up after 4,000 files and came back empty after ten seconds, every time. The search now runs on the ripgrep VS Code itself ships (or one on your PATH), which is ignore-aware and covers the tree in well under a second; the in-process walk remains only as the fallback for a machine with neither. A file scope is searched as a file.
- **The agent can now ASK its project memory, not only write to it.** `remember_fact` stored what a run learned into the project's shared memory, but nothing in the run could read it back mid-task, so every rediscovery was paid for in file reads. A `recall_facts` tool joins it — the editor twin of the `memory_recall` a Claude Code session uses — and the agent is told to recall before it searches and to remember durable findings (a root cause, where a behaviour lives) under a stable key so the next run skips the rediscovery. Both tools stay in the advertised set on every turn.
- **A run in the Brain panel starts from what the project already knows.** The native `@builderforce` participant has long opened each turn with the platform context — the project's durable memory, the ticket's PRD, governance, prior Evermind lessons. The panel's run did not, so it began every task with no memory of what earlier runs had recorded. Both surfaces now read the same context block from the same source.
- **A project with no base Evermind gets one the first time a run could teach it.** "Learn from every run" was switched on and the panel read "connected", yet every turn reported "did not learn — not seeded", because a project created before starter models were provisioned had no version to learn into, and nothing ever gave it one. The learn gate now seeds the starter base itself on the first teachable turn, so that turn — and every one after it — trains the project's own model.

## [2026.9.22] — The agent files its own ticket, tidies the branch, and stops fighting cmd.exe

*Released as part of 2026.9.23 — no separate 2026.9.22 build was cut.*

- **The agent stops handing you the commands and runs them itself.** A turn could end "I applied the fix — now run `pnpm type-check`, then commit and push", and every guard we had read that as a finished answer: it is not a promise, not a pseudo tool call, not a blank turn, so nothing objected. You asked for the errors to be fixed and got the verification step assigned to you instead — which meant nobody ran it, and the next CI failure was the first anyone heard of it. A reply that hands back shell or git steps this session could have taken is now caught and sent back to the model to carry out, and the persona says the same thing in its own words. Steps that genuinely are not the agent's — a credential, a browser, a VS Code restart — are left alone, and so is any answer to a question you actually asked ("how do I run the type-check?" is still answered with the command). If it burns its whole budget still handing work back, the run says so plainly and marks the change unverified rather than letting it read as done.
- **A code change is on the board from the FIRST edit, not from the end of the run.** The ticket that ties an editor change back to its chat was minted in the run's teardown — a step a Stop skips and a closed or reloaded panel never reaches. A measured run edited files for thirteen hours and finished with nothing recorded, because the one moment it would have written anything was a moment it never got to. The ticket is now opened on the first successful edit and linked to the conversation there and then; whatever happens to the rest of the turn, the work is visible and traceable.
- **One ticket per run, not two.** The run and the model were both following the same "record what you changed" instruction from opposite ends, so a turn that went well could leave two tickets for one change. The model's own `tickets.from_delta` call is now pointed at the ticket the run already opened, and attaches to it — unless the model names a better one itself, which always wins.
- **`git_cleanup_merged`: the last step of shipping now has a verb.** Everything else moved work forward and nothing put the checkout back, so a run that landed its change left you parked on a dead ticket branch with a stale `main` — and the agent, improvising the step through the shell, ran `git push origin --delete <branch>` and reported a failure ("remote ref does not exist") for a branch GitHub had already deleted on merge. The new tool returns to the base branch, fast-forwards it, and deletes the merged branch locally and on origin, treating an already-deleted remote branch as the success it is. It refuses on a dirty tree and refuses to delete unmerged work; a squash-merged branch takes `force`.
- **A push made the safe way now counts as shipping.** Delta tickets were meant to close themselves once the change landed. The check read shell commands for `git push`, so it only ever saw a hand-rolled push — a run that shipped through the `git_push` tool, which is the route we tell it to take, never counted, and its ticket sat at 50% on the board forever.
- **`run_command` stops failing on things `cmd.exe` simply does not have.** `git log --oneline | head -5` came back with `'head' is not recognized as an internal or external command` — the command was never attempted. Unix pipelines now go to the same bash the git scripts already use, and any command cmd.exe cannot even parse is retried there once. A build or test that genuinely fails is untouched and never re-run.
- **A commit with the wrong path prefix says so.** Committing with `repo` set while passing workspace-root paths made git warn about a directory like `api/api/src/…`, stage nothing, and answer "nothing to commit" — a wrong-path failure wearing an empty-diff message. Each path is now resolved against the repository first, the obvious prefix mistakes are tried automatically, and what cannot be found is named in the error.

## [2026.9.21] — Chats run side by side, and the agent stops going round in circles

- **The Auto-mode switch no longer answers a question a different chat was asked.** Runs live in the extension host so you can switch chats — or close a tab — while the work behind it carries on. But Auto was one switch for every live run: turning it on to stop *this* refactor asking you also said yes to whatever another conversation was parked on, in a tab you were not looking at. It now applies to the chat whose panel you flipped it in, and re-applies when you come back to a chat that is waiting on you.
- **A run starting in one chat no longer rewrites what another chat's diagnostics report.** The "tools available to the model" count is matched against the chat the panel is showing, so a copied report names that conversation's catalogue and not whichever run happened to start last.
- **The loop guard survives verification.** The advisory that catches an agent re-reading the same file over and over was reset by every `run_command` — so any run that builds, typechecks or tests between reads never reached the threshold, and the guard was effectively off for exactly the runs that do real work. A real run spent 46% of 99 tool calls revisiting ground it had already covered with the guard silent throughout. Re-reading straight after a build is still free, because that is the right move; going back a second time with nothing changed in between is not.
- **Repeating a call that has already failed the same way twice is now called out.** An identical failing call got no pushback at all: `git_status` was answered three times with the same "pass `repo` to name the checkout" remedy and re-issued bare each time. The first retry is still free — flakes are real — but from the second the result carries the count, the error already given, and the moves that remain.

## [2026.9.20] — An @-addressed agent does the work in its own runtime

- **"Bob, merge your changes and push to main" now reaches Bob's runtime.** A message addressed to an invited agent is answered on the server, which has no working tree — so the agent could only say it had no git tool, while its clone, shell and git were sitting in its container. The agent now hands such an instruction to its own run: it steers a live run, resumes a paused one, or starts a follow-up run on the same ticket branch its previous run left the changes on, and that run narrates in the chat. A container run told explicitly to push to main does so and reports the commit.
- **Withdrawn: running an addressed agent inside the editor.** Two interim builds ran an @-addressed agent in the editor's loop with the workspace's tools. That aimed at the wrong tree — the agent's changes are in its own runtime, not in your folder — so it is gone; addressed agents always execute where their work is.
- **"Commit and push to main" for the Brain itself is unchanged from 2026.9.18:** commit takes the same base-branch declaration a push does, and the persona carries out an explicit push to main instead of arguing for a pull request.

## [2026.8.141] — Local models kept their platform tools, and a wrong explanation was withdrawn

- **Pinning a model on your machine silently disconnected every platform tool.** Projects, tasks, OKRs and the rest are fetched from the gateway, but the panel was fetching them from wherever the MODEL lived — so choosing an on-device model pointed that lookup at your local runtime, which serves no such thing. The catalogue failed, the Brain lost its tools, and turns answered "I don’t have that data" with nothing in the trace. Where the model runs and where your work lives are now two separate questions.
- **"This is a model limitation, not a configuration error" is no longer said.** When a run ends without the model ever calling a tool, that notice used to rule out configuration outright and tell you to pick a different model. It was wrong in the case that matters most: a self-hosted runtime rejecting every request — a prompt over its context budget, say — looks exactly the same from inside the chat, and the real reason was sitting in the runtime’s own log while we sent you to change models. The notice now says the two are indistinguishable from here and points at the log that separates them.
## [2026.8.140] — Your machine’s models are in the chat’s own model menu

- **The `/` model menu in the chat panel had no way to pick a local model.** It is built from the list of models our gateway serves, which by definition cannot know what Ollama or FreeToken is running on your laptop — so the **On this device** group appeared only in the command palette, and the menu you actually type next to offered nothing but gateway models. On-device models now lead that menu, above every funded group, because nothing on the list is cheaper than hardware you already own.
- **The menu now stands up on its own when the gateway list cannot be fetched** — signed out, or with the network down. That is exactly when a model on your own machine is the one you want, and it used to be the moment the menu disappeared entirely.
- **One list, one set of words.** The palette picker and the chat menu are now built from the same rows, so the group heading and the "runs on this machine via Ollama" line cannot drift apart between the two places you choose a model.
## [2026.8.139] — Permission Mode now actually moves the panel

- **Setting Permission Mode to `acceptEdits` left the chat panel still asking.** The setting moved the `@builderforce` participant, which reads it every turn, while the panel kept its own Auto-mode switch — defaulted off in code, remembered separately, and never once looking at the setting. One question about your working tree, answered two different ways depending on which surface you happened to use. The panel now starts from the setting, and an open panel follows it the moment you change it.
- **Your in-panel switch still wins, until you change the setting again.** Flipping Auto mode by hand sticks across reloads as it did before; changing the setting is the newer instruction and overrides it. That includes turning it back down: switching to `ask` disarms a panel someone left on auto, which is the direction that matters most.
## [2026.8.138] — The chat now says when the answer came from your own machine

- **Picking a model on this machine did not change what the chat said it was running.** The composer still read "Builderforce Free" — our name for a turn our gateway routed — while the answer was in fact produced by your GPU and never left the building. The picker was the only place that ever said "On this device", and it says it once, at the moment you choose. Every surface that names a model now names an on-device one: the composer chip, the provenance line under a reply, and the model picker.
- **Why it was hidden at all.** Model names are deliberately masked on a routed plan, so a plan that picks the model per turn cannot leak an upstream name you never chose. A model on your own machine is the opposite of that case — you chose it and you own the hardware — so it is now treated like your other configured models, which were already exempt.
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
