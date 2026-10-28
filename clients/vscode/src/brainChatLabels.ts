import * as vscode from "vscode";

/**
 * Localized UI strings handed to the bundled React webview. The webview ships no
 * i18n stack of its own (next-intl is web-only), so the host translates here via
 * `vscode.l10n` (editor display language) and forwards the bundle through `init`.
 * Keys are the webview's namespace; the l10n lookup is keyed off the English message.
 */
export function brainChatLabels(): Record<string, string> {
  const t = vscode.l10n.t;
  return {
    // <BrainTimeline> (shared transcript UI)
    "tl.thinking": t("Thinking…"),
    // The ANIMATED in-flight row (<LiveActivity>) — the ONLY thing on screen while a
    // long tool call runs, so every phase line is localized like any other visible
    // string. `{tool}` / `{target}` / `{step}` / `{elapsed}` are substituted by the
    // renderer, not by l10n.
    "tl.liveStarting": t("Starting…"),
    "tl.liveWriting": t("Writing the reply…"),
    // A turn streaming a tool call's ARGUMENTS. `{bytes}` is the size so far — the one
    // thing that proves a three-minute `write_file` call is working, not wedged.
    "tl.liveComposing": t("Composing a {tool} call…"),
    "tl.liveComposed": t(" — {bytes} so far"),
    "tl.liveTool": t("Running {tool}"),
    "tl.liveAwaiting": t("Waiting for you to approve {tool}"),
    "tl.liveFinishing": t("Wrapping up…"),
    "tl.liveOn": t(" on {target}"),
    "tl.liveStep": t("step {step}"),
    "tl.liveSlow": t("Still working — {elapsed} elapsed"),
    "tl.liveAria": t("Current activity"),
    "tl.thoughtFor": t("Thought for {duration}"),
    "tl.thought": t("Thought"),
    "tl.replyFromThought": t("Recovered from the model's reasoning — the turn ended without a separate reply."),
    "tl.stoppedReply": t("Stopped by you — this is what the model had written when you pressed Stop."),
    "tl.stoppedBeforeStart": t("Stopped by you before the run started — nothing was done."),
    "tl.you": t("You"),
    "tl.assistant": "BuilderForce",
    "tl.input": t("Input"),
    "tl.output": t("Output"),
    // A shell step renders as a terminal exchange — the command, then what it printed.
    // `{code}` is substituted by the renderer, not by l10n.
    "tl.noOutput": t("No output"),
    "tl.exitCode": t("Exit {code}"),
    "tl.error": t("Error"),
    "tl.loading": t("Loading…"),
    "tl.empty": t("Ask BuilderForce to build or change something."),
    "tl.copy": t("Copy"),
    "tl.copied": t("Copied"),
    "tl.replay": t("Send again"),
    "tl.rateUp": t("Good response"),
    "tl.rateDown": t("Bad response"),
    "tl.apply": t("Apply"),
    "tl.createFile": t("Create file"),
    "tl.preview": t("Preview"),
    // Evermind memory steps — recall before answering, a memory-first answer that skipped
    // the model, and learn / reconcile after. `{count}` / `{version}` / `{name}` /
    // `{projectId}` / `{reason}` are substituted by the renderer, not by l10n.
    "tl.recallTitle": t("Recalled {count} memories from Evermind v{version}"),
    "tl.recallHint": t("This project's self-learning Evermind recalled these prior learnings and grounded the answer on them."),
    "tl.memoryAnswerCache": t("Answered from a saved reply — no model was called"),
    "tl.memoryAnswerEvermind": t("Answered by Evermind v{version} — no other model was called"),
    "tl.memoryAnswerHint": t("This project's memory already held an answer to this exact question, so it was replayed instead of running a model."),
    "tl.memoryAnswerSymbols": t("Answered from the workspace symbol index — no model was called"),
    "tl.memoryAnswerSymbolsHint": t("The request only asked where these names are defined, and the symbol index resolved every one of them, so the definitions were listed instead of running a model."),
    "tl.learnTitle": t("Contributed this turn to Evermind v{version}"),
    "tl.learnHint": t("This turn was contributed back to the project Evermind — it will be merged into the learned model."),
    "tl.learnTargetContributed": t("Contributed to {name} (project #{projectId} v{version})"),
    "tl.learnTargetSkipped": t("Skipped {name} (project #{projectId}) — {reason}"),
    "tl.reconcileTitle": t("Reconciled {count} learned memories in Evermind v{version}"),
    "tl.reconcileHint": t("The answer restated these recalled learnings, so it updates them (write-through cognition)."),
    // A run that moved models: the conversation fitted to the next model's window, or a
    // local-first turn that fell over. `{…}` are the renderer's tokens.
    "tl.modelMovePacked": t("Conversation fitted to {models} — {dropped} earlier messages {how}, ~{tokens} tokens"),
    "tl.modelMoveVerbatim": t("Conversation handed to {models} in full, ~{tokens} tokens"),
    "tl.modelMoveOverWindow": t("It is still larger than the model’s context window."),
    "tl.modelMoveHowSummarized": t("summarized"),
    "tl.modelMoveHowRecalled": t("replaced by recalled memory"),
    "tl.modelMoveHowElided": t("left out"),
    "tl.modelMoveLocalFallback": t("{from} on this device could not take this turn — {to} answered it"),
    "tl.modelMoveHint": t("The run moved to another model, so the conversation was fitted to that model’s context window."),
    "tl.contextCompacted": t("Context auto-compacted: older steps summarized into a memory ({count})"),
    "tl.contextCompactedHint": t("The conversation outgrew its working budget, so the older part was summarized into a memory note the model keeps working from. Nothing is deleted from this transcript."),
    "tl.showEarlier": t("Show earlier steps ({count})"),
    "tl.showNewer": t("Show newer steps ({count})"),
    "tl.jumpToLatest": t("Jump to latest"),
    // Run milestones + agent dispatch render as system ACTIVITY lines in the shared
    // transcript, composed client-side from each message's structured metadata. The
    // server records the FACTS in one language; these templates are what make the line
    // readable in the editor's. `{…}` are substituted by the renderer, not by l10n.
    "tl.activityStarted": t("{agent} started working on {kind} #{ref}"),
    "tl.activityCompleted": t("{agent} finished {kind} #{ref}"),
    "tl.activityCompletedWithLane": t("{agent} finished {kind} #{ref} — moved to {lane}"),
    "tl.activityFailed": t("{agent}'s run on {kind} #{ref} failed"),
    "tl.activityPaused": t("{agent} paused on {kind} #{ref} — waiting on a human answer"),
    "tl.activityPausedWithQuestion": t("{agent} paused on {kind} #{ref} — needs an answer: {question}"),
    "tl.activityResumed": t("{agent} resumed work on {kind} #{ref}"),
    "tl.activityCancelled": t("{agent}'s run on {kind} #{ref} was cancelled"),
    "tl.activityDispatched": t("{agent} was assigned to {kind} #{ref}"),
    // Composer + chrome (the sign-in / connecting states come from `authLabels`)
    "app.summarizeNeedsAccount": t("Summarizing a chat needs a BuilderForce account. This conversation is only on this machine."),
    "app.newChat": t("New chat"),
    "app.conversation": t("Conversation"),
    "app.rename": t("Rename chat"),
    "app.renamePlaceholder": t("Chat name"),
    // The inline-editable chat title in the header: the button's accessible name, the
    // field's label, and the two outcomes (which are also Enter/Escape).
    // The actionable half of an entitlement error: the banner buttons take the user
    // to the page that unblocks the turn.
    "app.upgrade": t("Upgrade"),
    "app.upgradeToPlan": t("Upgrade to {plan}"),
    "app.addCard": t("Add a card"),
    // The `sign_in` verdict: no model can serve the turn (signed out, nothing local).
    "app.noModel": t("No model is available. Sign in, or start a model on this device."),
    "app.copyChat": t("Copy chat diagnostics (plan + usage + identity + Evermind state + transcript)"),
    // A copy that FAILED must read differently from one that never ran — the button
    // used to swallow every rejection, so a broken export looked like a dead control.
    "app.copyFailed": t("Could not build the chat diagnostics report."),
    // Pending ask_user question, restated at the composer so a blocked chat is
    // answerable without hunting back through the transcript for its card.
    "app.askPending": t("Answer needed"),
    "app.askJumpTo": t("Show in conversation"),
    // Consolidate + Fork — rows in the composer's `/` menu (they act on the CHAT,
    // not the next turn), grouped there under the existing `app.conversation` heading.
    "app.sessionUnavailable": t("Available once this chat has a few messages and no run in flight"),
    "app.consolidate": t("Consolidate"),
    "app.consolidateHint": t("Summarize this chat into a compact context the rest of the conversation builds on"),
    "app.consolidating": t("Consolidating…"),
    "app.fork": t("Fork"),
    "app.forkHint": t("Summarize this chat and continue in a new one from that summary"),
    "app.forking": t("Forking…"),
    "app.forkTitle": t("Fork of {title}"),
    // Per-chat project-Evermind memory switch
    "app.memory": t("Memory"),
    "app.memoryOnHint": t("Memory on — this chat recalls and learns from the project Evermind"),
    "app.memoryOffHint": t("Memory off — this chat is a scratch space (no recall, no learning)"),
    "app.memoryUnavailable": t("This chat has no project memory to recall from — link it to a project first"),
    "app.diagnostics": t("Run connection diagnostics"),
    "app.visualize": t("Open the visualization beside the chat"),
    "app.version": t("BuilderForce extension version {version}"),
    "app.remove": t("Remove"),
    // Composer toolbar (Claude-style + / menus, auto mode, dictation)
    "app.add": t("Add"),
    "app.options": t("Options"),
    // The composer's "who" controls — the shared brain-ui RecipientPicker ("To") and
    // PersonaPicker ("Acting as"), worded the same as the web composer's.
    "app.to": t("To"),
    "app.recipientPickerTitle": t("Send to"),
    "app.brainRecipient": "BuilderForce",
    "app.brainRecipientHint": t("Runs it"),
    "app.agentRecipientHint": t("Replies & acts"),
    "app.humanRecipientHint": t("Notified"),
    "app.messageParticipant": t("Message {name}…"),
    "app.mentionTitle": t("Direct to"),
    "app.mentionAgent": t("Agent"),
    "app.mentionHuman": t("Person"),
    // The `#`-ticket typeahead beside the `@`-mention one above. These three were the
    // only composer labels the webview asked for that the host never supplied, so they
    // fell through to their hardcoded English fallbacks in every locale — invisible,
    // because a fallback renders exactly like a translation nobody has checked.
    "app.ticketTagTitle": t("Tag ticket"),
    "app.ticketTagStatus": t("Status"),
    "app.ticketTagNoMatches": t("No tickets found"),
    "app.actingAs": t("Acting as"),
    "app.personaTitle": t("Brain agent or persona"),
    "app.defaultBrain": t("Default Brain"),
    "app.personas": t("Personas"),
    "app.assignedAgents": t("Assigned agents"),
    "app.persona.modality.designer": t("Website"),
    "app.persona.modality.mobile": t("Mobile"),
    "app.persona.modality.webmobile": t("Web + Mobile"),
    "app.persona.modality.evermind": "Evermind",
    "app.persona.modality.finetune": t("Fine-tune"),
    "app.persona.modality.voice": t("Voice"),
    // Chat | Work — the CONVERSATION's mode (migration 0409), not an editor setting.
    // The same chat opened on the web reads the same mode, which is the whole point:
    // one conversation means one thing on every surface.
    // The "Changes (N)" pill in the ticket rail — the chat's own "this turn left
    // code on disk" signal — and the drawer it opens. The pill word is the SAME
    // source string as the Changes sidebar's title, and the status words are the
    // ones `pendingChangesTree.ts` renders, so one catalog entry serves both.
    "changes.pill": t("Changes"),
    "changes.summary": t("{count} uncommitted changes"),
    "changes.summaryOne": t("1 uncommitted change"),
    "changes.hint": t("Changed in your workspace and not committed yet."),
    "changes.review": t("Review"),
    "changes.staged": t("staged"),
    "changes.status.modified": t("modified"),
    "changes.status.added": t("added"),
    "changes.status.deleted": t("deleted"),
    "changes.status.renamed": t("renamed"),
    "changes.status.untracked": t("new"),
    "changes.status.conflict": t("conflict"),
    "changes.status.typechange": t("type changed"),
    "app.mode": t("Mode"),
    "app.modeChat": t("Chat"),
    "app.modeChatHint": t("Just answer — read and reason as much as needed, but do not open or dispatch board work"),
    "app.modeWork": t("Work"),
    "app.modeWorkHint": t("Turn what we agree into tracked work — open the ticket, staff it, and dispatch an agent to run it"),
    "app.uploadFile": t("Upload from computer"),
    "app.uploading": t("Uploading…"),
    "app.addContext": t("Add context"),
    "app.browseWeb": t("Browse the web"),
    "app.on": t("On"),
    "app.off": t("Off"),
    "app.effort": t("Effort"),
    "app.effortQuick": t("Quick"),
    "app.effortBalanced": t("Balanced"),
    "app.effortThorough": t("Thorough"),
    // What each Effort level actually does. `{answer}` is the level's max answer
    // tokens, substituted client-side (same convention as `app.forkTitle`'s
    // `{title}`); `app.effortDescThinking` is appended only when Thinking is on,
    // with `{thinking}` = the level's thinking budget.
    "app.effortDesc.quick": t("Fastest and cheapest — short, direct answers. Up to {answer} answer tokens."),
    "app.effortDesc.balanced": t("The default — normal depth. Up to {answer} answer tokens."),
    "app.effortDesc.thorough": t("Deepest and slowest — exhaustive, verifies its work. Up to {answer} answer tokens."),
    "app.effortDescThinking": t("+ {thinking} thinking tokens."),
    "app.thinking": t("Thinking"),
    // Thinking toggle description — `{budget}` is the current effort's thinking budget.
    "app.thinkingOnDesc": t("The model reasons before answering, with a {budget}-token thinking budget at this effort. Slower, better on hard problems."),
    "app.thinkingOffDesc": t("Off — the model answers directly. Turn on for a reasoning pass before the answer."),
    "app.contextMeterHint": t("Context: {used} of {limit} tokens on the last turn ({percent}). Older history is auto-compacted as it fills."),
    "app.contextMeterHintTokens": t("Context: {used} tokens on the last turn. Older history is auto-compacted as it fills."),
    // The `/` menu's own chrome. The model ROWS' copy (categories, funding lines,
    // Auto/Pool/Evermind naming) is not here: it is shared with the host's
    // `Change model` QuickPick and travels as `init.modelLabels`
    // (see `modelChoiceLabels.ts`), so the two pickers cannot word the same row
    // differently.
    "app.model": t("Model"),
    "app.modelInUse": t("Model in use"),
    "app.searchModels": t("Search models…"),
    "app.filterModels": t("Filter models"),
    "app.noModels": t("No matching models"),
    "app.all": t("All"),
    "app.modelLocked": t("Model choice needs a paid plan or a connected provider account."),
    "app.accountSettings": t("Account settings"),
    "app.status": t("Status"),
    "app.statusLoading": t("Loading account…"),
    "app.account": t("Account"),
    "app.usage": t("Usage"),
    "app.plan": t("Plan"),
    "app.resets": t("Resets"),
    "app.unlimited": t("Unlimited"),
    "app.managePlan": t("Manage plan"),
    "app.autoModeHint": t("Auto-approve tool actions without asking"),
    "app.pickModel": t("Change model"),
    "app.dictate": t("Dictate"),
    "app.stopDictation": t("Stop dictation"),
    "app.send": t("Send"),
    "app.stop": t("Stop"),
    // Steer-while-running (PRD 35 E10): a message sent during a run goes INTO it now;
    // "Queue for after" (its button, or Alt/⌥+Enter — `{keys}`, per platform) holds it,
    // drained one per completed run.
    "app.queueSend": t("Send into the running turn now"),
    "app.queueAfter": t("Queue for after the run ({keys})"),
    "app.queueAfterShort": t("Queue"),
    "app.queuedLabel": t("Queued for after the run"),
    "app.queuedHint": t("Queued — sends when the run finishes"),
    // Fixed next-step chips over an empty composer (never a model call).
    "app.suggestions": t("Suggested next steps"),
    "app.suggestReview": t("Review my changes"),
    "app.suggestReviewPrompt": t("Review my uncommitted changes and point out anything risky."),
    "app.suggestTests": t("Write tests"),
    "app.suggestTestsPrompt": t("Write tests for the file I have open."),
    "app.suggestExplain": t("Explain this file"),
    "app.suggestExplainPrompt": t("Explain how the file I have open works."),
    "app.placeholder": t("Ask BuilderForce to build or change something…"),
    "app.confirmRun": t("Run {name}?"),
    "app.approve": t("Approve"),
    "app.cancel": t("Cancel"),
    "app.always": t("Always"),
    "app.confirmAria": t("Approve this action"),
    "app.dismiss": t("Dismiss"),
    "app.reconnect": t("Reconnect"),
    "app.byoUnused": t("Your connected {provider} account couldn’t be used this run (its token looks expired or revoked), so it ran on the shared model pool instead of your own model. Reconnect it in the web app under Settings ▸ API Keys."),
    "app.byoOtherWorkspace": t("Your {provider} account is connected in a DIFFERENT workspace, so this run used the shared model pool instead of your own model. Switch to that workspace, or connect it in this one under Settings ▸ API Keys."),
    "app.taskSeed": t("Let's work on {task}."),
    "app.taskSeedDispatched": t("I just dispatched {task} to run on the platform. Check the latest execution's status and trace, then help me follow up."),
  };
}
