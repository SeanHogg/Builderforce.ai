# BuilderForce for VS Code

A codebase-aware BuilderForce AI coding agent in your editor sidebar.

> **Status:** working agent. It signs you in (browser or paste-key), scans the open folder
> for grounding, and edits files in that folder with your approval. The remaining PRD 14
> items (reusing the web `BrainPanel` UI, PRD 13 learned routing) are tracked in
> [PRD 14](../../specs/builderforce/14-prd-vscode-extension.md).

## Features

- **Coding agent** — runs an agentic tool-calling loop that reads and edits files in your
  open folder (sandboxed to that folder), with per-edit Apply/Skip approval.
- **Codebase grounding** — scans the open folder once (cached) into
  `.builderforce/architecture.md` + a summary injected as agent context, so it understands
  your project. Refresh anytime with **Rescan Codebase**.
- **Browser sign-in** — one-click device-code login (falls back to paste-key); your key is
  stored in the OS keychain via SecretStorage, never in settings or logs.
- **Bring your gateway** — `https://api.builderforce.ai` by default; override
  `builderforce.baseUrl` for self-hosted deployments.
- **Model picker** — choose from the live gateway model pool, or let the gateway choose.

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
