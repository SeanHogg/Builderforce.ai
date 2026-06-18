# Change Log

All notable changes to the BuilderForce VS Code extension are documented here.

## [2026.6.17] — Initial publishing surface

- Sidebar **Chat** webview (Activity Bar container) with streaming responses from the
  BuilderForce gateway (`/llm/v1/chat/completions`).
- **Sign in / Sign out** via SecretStorage (OS keychain). v0 uses paste-key; browser
  device-code login lands once the `/api/auth/device/*` endpoints deploy (PRD 14).
- **Pick model** from the live gateway pool (`/llm/v1/models`, cached).
- **New chat**, **Open settings** commands; configurable `baseUrl`, `defaultModel`,
  `permissionMode`.
- Dual-registry publish pipeline (VS Code Marketplace + Open VSX).

> Next phases (PRD 14): browser device-code auth, the reused `BrainPanel` UI from
> `@seanhogg/builderforce-brain-embedded/ui`, in-process `agentLoop` against the open
> folder, codebase scan + knowledge summary, and PRD 13 learned routing.
