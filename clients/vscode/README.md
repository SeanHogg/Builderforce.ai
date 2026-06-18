# BuilderForce for VS Code

Chat with a codebase-aware BuilderForce AI agent directly in your editor sidebar.

> **Status:** v0 publishing surface. The sidebar chat streams from the BuilderForce
> gateway today. The full agent (browser device-code login, the reused `BrainPanel` UI,
> in-process `agentLoop` editing your open folder, codebase scan + learned routing) ships
> across the phases in [PRD 14](../../specs/builderforce/14-prd-vscode-extension.md).

## Features

- **Sidebar chat** — a BuilderForce icon in the Activity Bar opens a streaming chat view.
- **Bring your gateway** — points at `https://api.builderforce.ai` by default; override
  `builderforce.baseUrl` for self-hosted deployments.
- **Secure auth** — your key is stored in the OS keychain via VS Code SecretStorage, never
  in settings or logs.
- **Model picker** — choose from the live gateway model pool, or let the gateway choose.

## Getting started

1. Install the extension.
2. Click the **BuilderForce** icon in the Activity Bar.
3. Click **Sign In** and paste your API key (get one at https://builderforce.ai).
4. Ask away.

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
