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
  OKRs directly in chat. Kick off a run on a ticket and follow its status without switching to
  a dashboard.
- **It knows your codebase** — scans the open folder once (cached) and grounds every answer in
  your project's real structure, so suggestions fit your code. Refresh with **Rescan
  Codebase**.
- **Show it a screenshot** — paste or attach an image of a bug, error, or design and the agent
  acts on what it sees.
- **See exactly what it did** — every step (its reasoning, each tool call with input/output,
  file edits, and errors) is visible, so you can trust and verify the work. One click copies
  the whole transcript for a teammate or support; another runs connection diagnostics.
- **Pick up anywhere** — your conversations are the same ones in the BuilderForce web app, so
  you can start in the editor and continue in the browser (or the reverse).
- **Secure sign-in** — one-click browser login (or paste-key); your key lives in the OS
  keychain, never in settings or logs.
- **Your gateway, your models** — defaults to `https://api.builderforce.ai`; override
  `builderforce.baseUrl` for self-hosted, and pick any model from the live pool or let the
  gateway choose.

## Getting started

1. Install the extension and open the folder you want to work in.
2. Click the **BuilderForce** icon in the Activity Bar.
3. Click **Sign In** (a browser opens to approve, or paste an API key from
   https://builderforce.ai).
4. Ask it to build or change something — it will scan the repo, propose edits, and apply
   them on your approval.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `builderforce.baseUrl` | `https://api.builderforce.ai` | Gateway base URL; `/llm/v1/...` is appended. |
| `builderforce.defaultModel` | `""` | Default model id (empty = gateway chooses). |
| `builderforce.permissionMode` | `ask` | How the agent applies edits (`ask` \| `acceptEdits`). |

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
