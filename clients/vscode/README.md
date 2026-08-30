# BuilderForce for VS Code

A codebase-aware BuilderForce AI coding agent in your editor sidebar.

> **Status:** working agent. Sign in, point it at your repo, and ship — it edits code with
> your approval and runs your team's work without leaving the editor.

## Features

- **Ship code by chatting** — describe what you want and the agent finds the right code, edits
  it (sandboxed to the open folder), runs your tests/build/lint to verify it works, and can
  commit, push, and open a PR — going from idea to shipped without leaving the editor. Every
  change and command asks for your approval first.
- **Run your team's work from the editor** — open, update, and dispatch projects, tasks, and
  OKRs directly in chat, and kick off a run on a ticket and follow its status — no dashboard.
  A **Work Inbox** in the sidebar shows what needs you (pending approvals) with one-click
  starts to **review your pull requests** and their CI, **fix a production error** from the
  error straight to the code, or **open a pull request** for your changes.
- **It knows your codebase** — scans the open folder once (cached) and grounds every answer in
  your project's real structure, so suggestions fit your code. Refresh with **Rescan
  Codebase**.
- **Long chats keep going** — busy conversations that pull in big results (like a full task
  list) used to fill up and stall the assistant part-way through. Now the chat keeps only what
  matters as it works, so it stays responsive and finishes the job instead of dying after a
  few steps.
- **Show it a screenshot** — paste or attach an image of a bug, error, or design and the agent
  acts on what it sees.
- **See exactly what it did — and why it stopped** — every step (its reasoning, each tool call
  with input/output, file edits, and errors) is visible, so you can trust and verify the work.
  One click copies the whole transcript, now with a plain-English **Diagnostics** summary: if a
  chat ever stalls, the copy tells you the likely reason at a glance — perfect to drop into a
  bug report or hand to support. Another click runs connection diagnostics.
- **Pick up anywhere** — your conversations are the same ones in the BuilderForce web app, so
  you can start in the editor and continue in the browser (or the reverse).
- **Secure sign-in** — one-click browser login (or paste-key); your key lives in the OS
  keychain, never in settings or logs.
- **Your gateway, your models** — defaults to `https://api.builderforce.ai`; override
  `builderforce.baseUrl` for self-hosted, and pick any model from the live pool or let the
  gateway choose.
- **Or run the model on your own machine** — turn on `builderforce.localModels.enabled` and
  everything your **Ollama** install has pulled, plus whatever your **FreeToken** engine is
  serving, appears in the model picker under **On this device**. Pick one and the turn runs on
  your hardware with the same tools, edits, and approvals as any other chat: nothing is spent
  from your plan, and it keeps working with the network down. See
  [Running the model on your own machine](#running-the-model-on-your-own-machine) for what
  does and doesn't stay local.

## Getting started

1. Install the extension and open the folder you want to work in.
2. Click the **BuilderForce** icon in the Activity Bar.
3. Click **Sign In** (a browser opens to approve, or paste an API key from
   https://builderforce.ai).
4. Ask it to build or change something — it will scan the repo, propose edits, and apply
   them on your approval.

## Running the model on your own machine

The extension speaks the OpenAI-compatible API that both runtimes expose, so no adapter or
extra tooling is involved.

1. **Start a runtime** and leave it serving:
   - **Ollama** — `ollama serve`, with at least one model pulled (`ollama pull qwen3:8b`).
     Listens on `http://127.0.0.1:11434`.
   - **FreeToken** — start the engine for a model in the desktop app. Listens on
     `http://127.0.0.1:1919`.
2. **Turn it on** — tick **BuilderForce › Local Models: Enabled** in settings. Only change the
   two URL settings if you moved a runtime off its default address; both the bare address and
   the `/v1` form work.
3. **Pick a model** — run **BuilderForce: Pick Model** and choose a row under **On this
   device**. Each row is labelled with the runtime serving it.
4. **Chat as usual.** To go back to the gateway, pick any other model.

A runtime that isn't running simply contributes no rows — the picker still opens, so you can
run only one of the two.

### What stays on your machine, and what doesn't

**The inference is entirely local.** Your prompt, the code context gathered from your repo,
and the model's reply are exchanged only with the runtime on your machine. They are not sent
to the BuilderForce gateway or to any model provider, and the turn costs nothing from your
plan.

**Your transcript is still a platform record.** The sidebar chat saves its conversation to
your BuilderForce account exactly as it always has — that is what makes it the same
conversation in the web app — so the text of a local chat is stored server-side like any
other. The model that produced the text has no bearing on where the text is kept. The
`@builderforce` participant and the codebase scan store nothing when you are signed out.

If you need a turn that touches no server at all, use `@builderforce` in the VS Code chat view
with a local model picked and no account signed in.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `builderforce.baseUrl` | `https://api.builderforce.ai` | Gateway base URL; `/llm/v1/...` is appended. |
| `builderforce.defaultModel` | `""` | Default model id (empty = gateway chooses). |
| `builderforce.permissionMode` | `ask` | How the agent applies edits (`ask` \| `acceptEdits`). |
| `builderforce.localModels.enabled` | `false` | Offer models served by a runtime on this machine (Ollama, FreeToken) in the model picker. |
| `builderforce.localModels.ollamaUrl` | `http://127.0.0.1:11434` | Your Ollama runtime. `/v1/models` and `/v1/chat/completions` are appended, so the bare address and the `/v1` form both work. |
| `builderforce.localModels.freetokenUrl` | `http://127.0.0.1:1919` | Your FreeToken engine, same URL rules as above. |

## Development

```bash
npm install
npm run compile      # or: npm run watch
# Press F5 in VS Code to launch the Extension Development Host
```

## Publishing

See [PUBLISHING.md](./PUBLISHING.md) for the dual-registry (VS Code Marketplace + Open VSX)
release process.

## License

MIT © Sean Hogg / BuilderForce
