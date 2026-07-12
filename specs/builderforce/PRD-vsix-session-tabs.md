# PRD — VSIX Sessions: multi-tab chats + live tab status + pending-question surfacing

> Status: **Ready to implement (P1)** · Author: platform · Date: 2026-07-12 · Target VSIX: next after `2026.7.75`
> Surface: the VS Code extension `Builderforce.ai/clients/vscode`. All three features are **additive** and gated behind one new user setting (default = today's behaviour). This PRD is written to be implemented by an agent with **no prior context** — every file, symbol, message type, and string is named.

---

## 0. Background you need (do not re-derive)

**How a session opens today.** The sidebar **Sessions** view (`view id builderforce.sessions`, declared in [package.json](../../clients/vscode/package.json) lines 57-60) is backed by `SessionsTreeProvider` in [src/sessionsTree.ts](../../clients/vscode/src/sessionsTree.ts). Each row's click runs command `builderforce.openSession` ([sessionsTree.ts:93](../../clients/vscode/src/sessionsTree.ts#L93)), handled in [src/extension.ts:238](../../clients/vscode/src/extension.ts#L238):

```ts
vscode.commands.registerCommand("builderforce.openSession", (id) => {
  const chatId = chatIdOf(id);
  BrainWebview.open(context, chatId != null ? { kind: "focus", chatId } : { kind: "new" });
});
```

**The chat panel is a singleton.** `BrainWebview` in [src/brainWebview.ts](../../clients/vscode/src/brainWebview.ts) keeps `private static current` ([:173](../../clients/vscode/src/brainWebview.ts#L173)). `static open()` ([:181](../../clients/vscode/src/brainWebview.ts#L181)) **reuses the one panel** and merely posts a `focus` intent to switch which chat it shows:

```ts
static open(ctx, intent?) {
  if (BrainWebview.current) {
    BrainWebview.current.panel.reveal();
    if (intent) BrainWebview.current.sendIntent(intent);   // switch chat inside the same tab
    return;
  }
  BrainWebview.current = new BrainWebview(ctx, intent);
}
```

The actual `vscode.window.createWebviewPanel` is in the shared base `WebviewPanelBase` ([src/webviewShared.ts:82](../../clients/vscode/src/webviewShared.ts#L82)); `BrainWebview` constructs it with `viewType:"builderforce.brain", title:"BuilderForce"` ([:199](../../clients/vscode/src/brainWebview.ts#L199)). All other openers (`builderforce.newSession` [:235], `builderforce.openChat` [:382], `builderforce.openBrain` [:387], `builderforce.editorChat` [:390]) funnel through the same `BrainWebview.open`. `sendIntent` posts `{type:"intent", intent}` ([:366](../../clients/vscode/src/brainWebview.ts#L366)); the `BrainIntent` shape is `{kind:"new"|"focus"|"task"|"seed", chatId?, …}` ([:40](../../clients/vscode/src/brainWebview.ts#L40)).

**The status vocabulary already exists** and is the single source of truth for "what's live / what needs me": [src/attention.ts](../../clients/vscode/src/attention.ts).
- State enum `BfAttentionState = "running" | "awaiting_input"` (in [src/bfApi.ts:741](../../clients/vscode/src/bfApi.ts#L741)), sourced from `GET /api/runtime/attention` + a webview-local overlay.
- `attentionFor("chat", id)` ([attention.ts:63](../../clients/vscode/src/attention.ts#L63)) → the live state (or `undefined`).
- `attentionIcon(state)` ([:78](../../clients/vscode/src/attention.ts#L78)) → blue `loading~spin` (running) / amber `comment-unresolved` (awaiting).
- `attentionDescriptionPrefix(state)` ([:87](../../clients/vscode/src/attention.ts#L87)) → `"❓ "` for awaiting, `""` for running (the tree already carries a spinner icon, so running needs no glyph there).
- The Sessions **row** already renders all this ([sessionsTree.ts:82-90](../../clients/vscode/src/sessionsTree.ts#L82-L90)).
- Change signals that repaint the trees today: module event `onLocalRunsChange` ([attention.ts:38](../../clients/vscode/src/attention.ts#L38)) and `AttentionPoller.onDidChange` ([:100](../../clients/vscode/src/attention.ts#L100), adaptive 8s/30s). The webview reports its own running/awaiting chats via the `runs.local` inbound message ([brainWebview.ts:227](../../clients/vscode/src/brainWebview.ts#L227)) → `setLocalChatRuns` ([attention.ts:50](../../clients/vscode/src/attention.ts#L50)).

**The question card already exists.** `ask_user` blocks render as an answerable `QuestionCard` from the shared `@seanhogg/builderforce-brain-ui` package: parser `parseAskUser()` + `QuestionCard` in [packages/brain-ui/src/askUser.tsx](../../packages/brain-ui/src/askUser.tsx), lifted into the transcript in [packages/brain-ui/src/BrainTimeline.tsx:439-458](../../packages/brain-ui/src/BrainTimeline.tsx#L439-L458) via `onAnswerQuestion`. In the VSIX webview app the answer is posted as the next turn by `answerQuestion` in [clients/vscode/webview/src/App.tsx:1012](../../clients/vscode/webview/src/App.tsx#L1012).

**Localization.** The extension does NOT use next-intl. `package.json` uses `%key%` placeholders resolved from `package.nls.json` (+ `.de/.es/.fr/.zh-cn`); runtime strings use `vscode.l10n.t(...)` resolved from `l10n/bundle.l10n.json` (+ `.de/.es/.fr/.zh-cn`). Brain-ui is host-agnostic and framework-free — it takes strings via props/labels, and each host (web = next-intl 5 locales; VSIX = l10n bundles) supplies its own.

**Hard API constraint you must design around.** `WebviewPanel.iconPath` accepts only `Uri | {light:Uri, dark:Uri}` — **not** a `ThemeIcon`. So the animated `loading~spin` codicon the tree uses **cannot** be shown on a tab. Tab status is therefore conveyed by (a) a **title glyph** and (b) swapping `iconPath` between static PNGs. This is an accepted limitation, not a gap.

---

## The ask (three linked features)

1. **A setting to choose tab behaviour.** Keep today's one-reused-tab, OR open **one tab per session** so a user juggling many sessions can switch between them like normal editor tabs.
2. **Live status on each tab**, mirroring the Sessions row: a tab whose chat is **processing** shows a working indicator; a tab **awaiting an answer** shows the `❓` indicator.
3. **Surface the question** on a tab that needs one answered — a pinned "answer needed" section so the user answers without hunting through the transcript.

---

## FEATURE 1 — Setting: reuse one tab vs. one tab per session

### 1.1 New configuration property
In [package.json](../../clients/vscode/package.json) `contributes.configuration.properties` (the block at lines 637-668, alongside `builderforce.permissionMode`):

```jsonc
"builderforce.sessionTabs": {
  "type": "string",
  "enum": ["reuse", "perSession"],
  "default": "reuse",
  "markdownEnumDescriptions": [
    "%config.sessionTabs.reuse%",
    "%config.sessionTabs.perSession%"
  ],
  "description": "%config.sessionTabs.desc%"
}
```

`default:"reuse"` preserves today's behaviour exactly — this feature ships dark until the user opts in.

### 1.2 Reader helper (one place — DRY)
Add to [src/gateway.ts](../../clients/vscode/src/gateway.ts) next to `getBaseUrl`/`getWebBaseUrl`:

```ts
export type SessionTabMode = "reuse" | "perSession";
/** How the Sessions view opens chats: reuse one tab, or one tab per session. */
export function getSessionTabMode(): SessionTabMode {
  return vscode.workspace.getConfiguration("builderforce").get<SessionTabMode>("sessionTabs") === "perSession"
    ? "perSession"
    : "reuse";
}
```

Everything that decides tab behaviour reads this — never `getConfiguration(...).get("sessionTabs")` inline anywhere else.

### 1.3 `BrainWebview` — from singleton to a keyed registry
Replace the single `static current` with a registry that holds one panel in reuse mode and up to N panels (keyed by chat) in perSession mode. **Grep `BrainWebview.current` first** — it is referenced only inside `brainWebview.ts` (`open`, `refresh`, `onDispose`); update all three.

New static state on `BrainWebview`:
```ts
private static reuse: BrainWebview | undefined;          // the single reused panel (reuse mode)
private static byChat = new Map<number, BrainWebview>(); // perSession: one panel per chatId
private static unassigned = new Set<BrainWebview>();     // perSession: panels for a not-yet-saved new chat
```

Instance fields:
```ts
private ownChatId?: number;   // the chat this panel is bound to (perSession)
private chatTitle = "BuilderForce";
private readonly mode: SessionTabMode;
```

Rewrite `static open(ctx, intent?)`:
```ts
static open(ctx, intent?) {
  const mode = getSessionTabMode();

  if (mode === "reuse") {
    if (BrainWebview.reuse) {
      BrainWebview.reuse.panel.reveal();
      if (intent) BrainWebview.reuse.sendIntent(intent);
      return;
    }
    BrainWebview.reuse = new BrainWebview(ctx, intent, mode);
    return;
  }

  // perSession: focusing an already-open session reveals its existing tab (no duplicate)
  if (intent?.kind === "focus" && intent.chatId != null) {
    const open = BrainWebview.byChat.get(intent.chatId);
    if (open) { open.panel.reveal(); return; }
  }
  const w = new BrainWebview(ctx, intent, mode);       // new tab bound to this session
  if (intent?.kind === "focus" && intent.chatId != null) {
    w.ownChatId = intent.chatId;
    BrainWebview.byChat.set(intent.chatId, w);
  } else {
    BrainWebview.unassigned.add(w);                    // new/seed chat — key it once its id is known
  }
}
```

Constructor takes `mode` and stores it; when `ownChatId` is set at construction it seeds the tab title/icon immediately (see Feature 2).

**Binding a brand-new chat to its tab.** A `kind:"new"`/`kind:"seed"` panel has no chatId until the webview creates the chat server-side. The webview already tells the host which chats it is running via `runs.local`, and fires `chats.changed`; add a lightweight active-session report so the owning panel learns its id + title:

- Webview → host inbound `session.meta` `{chatId:number, title:string}` posted whenever the active chat (or its title) changes. Wire it in [clients/vscode/webview/src/App.tsx](../../clients/vscode/webview/src/App.tsx) next to where `runs.local` is posted.
- Host handler in `BrainWebview.onMessage` ([brainWebview.ts:207](../../clients/vscode/src/brainWebview.ts#L207)):
  ```ts
  case "session.meta": {
    const id = typeof msg.chatId === "number" ? msg.chatId : undefined;
    const title = typeof msg.title === "string" ? msg.title : undefined;
    this.bindSession(id, title);   // re-key in byChat if id changed, update tab title/status
    break;
  }
  ```
  `bindSession(id, title)`: if `mode==="perSession"` and `id != null` and `id !== this.ownChatId`, move `this` out of `unassigned`/its old `byChat` key into `byChat.set(id, this)`, set `ownChatId=id`; store `chatTitle` and call `applyTabStatus()` (Feature 2). No-op in reuse mode except updating `chatTitle`.

Add `chatId?` and `title?` to the `BrainInbound` interface ([brainWebview.ts:13](../../clients/vscode/src/brainWebview.ts#L13)).

**Fan-out the static helpers** (they assumed one panel):
- `static refresh()` ([:191](../../clients/vscode/src/brainWebview.ts#L191)) → iterate `allPanels()` calling `sendInit()`.
- Add `private static allPanels(): BrainWebview[]` returning `[reuse, ...byChat.values(), ...unassigned].filter(Boolean)`.
- `onDispose()` ([:488](../../clients/vscode/src/brainWebview.ts#L488)) → remove `this` from whichever registry holds it (`reuse` clear, `byChat.delete(ownChatId)`, `unassigned.delete(this)`).

### 1.4 Reveal existing per-session tab on repeat click
Covered by `open()` above — a `focus` intent for a chatId already in `byChat` reveals rather than re-creates. Verify: click session A (tab opens), click session B (second tab), click session A again → its existing tab is revealed, no third tab, and no chat-switch inside B.

---

## FEATURE 2 — Live status indicator on each per-session tab

### 2.1 Shared glyph vocabulary (DRY — keep it in attention.ts)
The tree's `attentionDescriptionPrefix` deliberately omits a running glyph (its row has a spinner icon). A **tab has no spinner icon available** (see §0 constraint), so running needs its own glyph. Add ONE new exported function next to `attentionDescriptionPrefix` in [src/attention.ts](../../clients/vscode/src/attention.ts) so the tab vocabulary lives in the same single file as every other state→visual mapping:

```ts
/** Title-prefix glyph for a webview TAB (no ThemeIcon/spinner available on a tab),
 *  so running gets its own glyph unlike the tree's description prefix. */
export function sessionTabPrefix(state: BfAttentionState): string {
  return state === "awaiting_input" ? "❓ " : state === "running" ? "⏳ " : "";
}
```

### 2.2 Tab icon assets + resolver
Add two PNGs to [clients/vscode/media/](../../clients/vscode/media/) (16×16 + 32×32 like the existing `icon.png`, theme-neutral so they read in light and dark tabs):
- `session-running.png` — a "working" glyph (e.g. filled activity dot / hourglass).
- `session-question.png` — a question mark.

Resolver in `attention.ts` (keeps the mapping beside `sessionTabPrefix`; takes the extension uri so it stays UI-framework-free):
```ts
export function sessionTabIcon(extUri: vscode.Uri, state: BfAttentionState | undefined): vscode.Uri {
  const file = state === "awaiting_input" ? "session-question.png"
             : state === "running" ? "session-running.png"
             : "icon.png";
  return vscode.Uri.joinPath(extUri, "media", file);
}
```

### 2.3 Apply status to the tab
Instance method on `BrainWebview`:
```ts
private applyTabStatus(): void {
  if (this.mode !== "perSession") return;                 // reuse mode keeps the static "BuilderForce" title
  const state = this.ownChatId != null ? attentionFor("chat", this.ownChatId) : undefined;
  this.panel.title = `${sessionTabPrefix(state ?? "" as never)}${this.chatTitle}`;
  this.panel.iconPath = sessionTabIcon(this.ctx.extensionUri, state);
}
```
(Guard the prefix call for `undefined` state cleanly — `state ? sessionTabPrefix(state) : ""`.)

Call `applyTabStatus()` from: constructor (after binding), `bindSession()`, and on every attention change.

### 2.4 Drive it from the existing single signal — no new polling (perf rule)
`attentionFor` already merges the server poll + the local overlay. Both change-signals already exist and already repaint the trees in [src/extension.ts](../../clients/vscode/src/extension.ts). In the SAME two handlers that refresh the trees (the `AttentionPoller.onDidChange` subscription and the `onLocalRunsChange` subscription), add one call:

```ts
BrainWebview.refreshTabStatus();
```

New static:
```ts
static refreshTabStatus(): void {
  for (const w of BrainWebview.byChat.values()) w.applyTabStatus();
  for (const w of BrainWebview.unassigned) w.applyTabStatus();
}
```

No second timer, no new endpoint — the tab rides the poller that already exists. This keeps the tab, the Sessions row, the web app, and the board all in lockstep off one `attentionFor`.

---

## FEATURE 3 — Surface the pending question on a tab that needs one answered

### 3.1 Problem
The `QuestionCard` renders inline in the transcript. On a long chat the user must scroll to find the `❓` question. When a session is `awaiting_input`, the question the tab is blocked on should be **surfaced** — a pinned "answer needed" section at the composer so it's answered in one click.

### 3.2 Build it once in brain-ui (shared by VSIX + web — DRY)
Add `PendingQuestionBanner` to [packages/brain-ui/src/askUser.tsx](../../packages/brain-ui/src/askUser.tsx) (beside `QuestionCard`, reusing the same `AskUserPayload`/`parseAskUser` and the same answer callback — do NOT re-parse or re-implement the options UI):

```tsx
/** A pinned, compact restatement of the LAST unanswered ask_user question, shown at
 *  the composer so the user answers without scrolling to the card in the transcript.
 *  Reuses AskUserPayload + the QuestionCard onAnswer contract. */
export function PendingQuestionBanner(props: {
  payload: AskUserPayload;
  onAnswer: (value: string) => void;
  onReveal?: () => void;   // scroll the in-transcript QuestionCard into view
  labels: { answerNeeded: string; jumpToQuestion: string };
}): JSX.Element { /* … */ }
```

Style with the SAME theme variables `QuestionCard` uses (webview `var(--vscode-*)`; the web app maps the same tokens) so it reads in light and dark, and lay it out fluid (wraps under ~360px). Strings arrive via the `labels` prop — no hardcoded English inside brain-ui.

### 3.3 Wire it in the VSIX webview
In [clients/vscode/webview/src/App.tsx](../../clients/vscode/webview/src/App.tsx):
- Derive the last unanswered `ask_user` from the transcript with the existing `parseAskUser` (the same derivation `BrainTimeline` uses — factor a shared `selectPendingAskUser(messages)` helper in brain-ui if the logic would otherwise be duplicated between `BrainTimeline` and `App`).
- Render `<PendingQuestionBanner>` above the composer when one exists, passing `onAnswer={answerQuestion}` (the existing handler at [App.tsx:1012](../../clients/vscode/webview/src/App.tsx#L1012)) and `onReveal` = scroll the matching `QuestionCard` into view.
- Localize `labels` via `vscode.l10n` values threaded from the host, or the webview's own l10n if it has one; add keys to all five l10n bundles (§5).

The pending state ties back to Feature 2: the same chat is `awaiting_input`, so the tab shows `❓` AND the banner shows the question — one consistent signal from tab to composer.

### 3.4 Web app parity (free, since brain-ui is shared)
The web chat that renders `BrainTimeline` should pass the same banner labels via next-intl (5 catalogs) so the web surface gains the same affordance. If the web chat host is out of scope for this pass, pass `undefined`/omit the banner there and log the web wiring to the Gap Register — do **not** fork the component.

---

## 4. Files touched (checklist)

| File | Change |
|------|--------|
| [clients/vscode/package.json](../../clients/vscode/package.json) | add `builderforce.sessionTabs` config; **bump `version`** |
| [clients/vscode/src/gateway.ts](../../clients/vscode/src/gateway.ts) | `getSessionTabMode()` + `SessionTabMode` type |
| [clients/vscode/src/brainWebview.ts](../../clients/vscode/src/brainWebview.ts) | registry (`reuse`/`byChat`/`unassigned`), `open()` rewrite, `bindSession`, `session.meta` handler, `applyTabStatus`, `refreshTabStatus`, fan-out `refresh`/`onDispose`; `BrainInbound` gains `chatId?`/`title?` |
| [clients/vscode/src/attention.ts](../../clients/vscode/src/attention.ts) | `sessionTabPrefix()`, `sessionTabIcon()` |
| [clients/vscode/src/extension.ts](../../clients/vscode/src/extension.ts) | call `BrainWebview.refreshTabStatus()` in the two existing attention-change handlers |
| [clients/vscode/media/](../../clients/vscode/media/) | `session-running.png`, `session-question.png` |
| [packages/brain-ui/src/askUser.tsx](../../packages/brain-ui/src/askUser.tsx) | `PendingQuestionBanner`, optional `selectPendingAskUser` |
| [clients/vscode/webview/src/App.tsx](../../clients/vscode/webview/src/App.tsx) | post `session.meta`; render `PendingQuestionBanner` |
| `package.nls.json` (+ `.de/.es/.fr/.zh-cn`) | `config.sessionTabs.desc/.reuse/.perSession` |
| `l10n/bundle.l10n.json` (+ `.de/.es/.fr/.zh-cn`) | banner + any new `l10n.t` strings |

**Do NOT touch** [src/chatSessions.ts](../../clients/vscode/src/chatSessions.ts) — that is the separate, feature-detected **proposed** chat-sessions API surface. This PRD lives entirely on the stable sidebar + `BrainWebview` path. Convergence between the two is logged as a gap (§7).

## 5. Localization (required, same pass)
- **`package.nls.*`** (`json` base + `de/es/fr/zh-cn`): add real translations for
  - `config.sessionTabs.desc` — "How the Sessions view opens chats."
  - `config.sessionTabs.reuse` — "Reuse a single chat tab, switching sessions inside it."
  - `config.sessionTabs.perSession` — "Open each session in its own tab so you can switch between them."
- **`l10n/bundle.l10n.*`** (`json` base + `de/es/fr/zh-cn`): the banner labels ("Answer needed", "Jump to question") and any new runtime string. Follow the existing keys' style; never leave non-en catalogs as English copies.
- Brain-ui stays string-free (labels via props). If web parity is wired (§3.4), add the keys to `frontend/src/i18n/messages/{en,zh,es,fr,de}.json`.

## 6. Testing / verification (drive the real extension)
1. `getSessionTabMode()` defaults to `reuse` → open 3 sessions: still **one** tab, switches inside it (today's behaviour, unchanged).
2. Set `builderforce.sessionTabs: perSession` → open 3 sessions → **3 tabs**; click session A again → its tab is revealed (no 4th tab, session B not switched).
3. Start a run in a per-session tab → tab title shows `⏳ <title>` + `session-running.png`; Sessions row and tab agree.
4. Trigger `ask_human` → tab shows `❓ <title>` + `session-question.png`; `PendingQuestionBanner` appears at the composer; answering via the banner clears both the banner and the `awaiting_input` state (tab returns to idle icon).
5. New chat (`kind:"new"`) opens a tab, then re-keys into `byChat` once the webview reports `session.meta` — its title/status begin updating.
6. Both themes + a ~360px-narrow webview: banner and tabs read correctly.

## 7. Rollout
- Bump `clients/vscode/package.json` `version`; run `vsce package` to produce the VSIX (per convention — do not publish). Bump any lockstep SDK/gateway version only if a public surface changed (it does not here).
- Feature ships behind `sessionTabs:reuse` default → zero behaviour change until opt-in.

## 8. Deferred / Gap Register
- **Proposed chat-sessions API convergence.** [src/chatSessions.ts](../../clients/vscode/src/chatSessions.ts) offers a native per-tab chat surface under `--enable-proposed-api`. This PRD delivers per-session tabs on the stable `BrainWebview` path instead; if VS Code promotes `chatSessionsProvider` to stable, the two per-tab implementations should converge onto one. Log to ROADMAP Gap Register.
- **Web chat parity for `PendingQuestionBanner`** (§3.4) if not wired this pass.
