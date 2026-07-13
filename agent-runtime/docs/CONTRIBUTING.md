# Contributing to BuilderForce Agents

Welcome aboard! 🤖

## Quick Links

- **GitHub:** https://github.com/seanhogg/builderforce
- **Docs:** [docs.builderforce.ai](https://docs.builderforce.ai) — documentation source lives in this repo under `docs-site/`.
- **Orchestration (Builderforce):** BuilderForce Agents leverages [Builderforce.ai](https://builderforce.ai) — API at **api.builderforce.ai**. Guides: [docs.builderforce.ai/link/](https://docs.builderforce.ai/link/) (getting started, API reference, marketplace, multi-agent).
- **Vision:** [`VISION.md`](VISION.md)
- **Discord:** https://discord.gg/qkhbAGHRBT
- **X/Twitter:** [@steipete](https://x.com/steipete) / [@builderforce](https://x.com/builderforce)

## Maintainers

- **Peter Steinberger** - Benevolent Dictator
  - GitHub: [@steipete](https://github.com/steipete) · X: [@steipete](https://x.com/steipete)

- **Shadow** - Discord subsystem, Discord admin, Agenthub, all community moderation
  - GitHub: [@thewilloftheshadow](https://github.com/thewilloftheshadow) · X: [@4shad0wed](https://x.com/4shad0wed)

- **Vignesh** - Memory (QMD), formal modeling, TUI, and IRC
  - GitHub: [@vignesh07](https://github.com/vignesh07) · X: [@\_vgnsh](https://x.com/_vgnsh)

- **Jos** - Telegram, API, Nix mode
  - GitHub: [@joshp123](https://github.com/joshp123) · X: [@jjpcodes](https://x.com/jjpcodes)

- **Ayaan Zaidi** - Telegram subsystem, iOS app
  - GitHub: [@obviyus](https://github.com/obviyus) · X: [@0bviyus](https://x.com/0bviyus)

- **Tyler Yust** - Agents/subagents, cron, BlueBubbles, macOS app
  - GitHub: [@tyler6204](https://github.com/tyler6204) · X: [@tyleryust](https://x.com/tyleryust)

- **Mariano Belinky** - iOS app, Security
  - GitHub: [@mbelinky](https://github.com/mbelinky) · X: [@belimad](https://x.com/belimad)

- **Seb Slight** - Docs, Agent Reliability, Runtime Hardening
  - GitHub: [@sebslight](https://github.com/sebslight) · X: [@sebslig](https://x.com/sebslig)

- **Christoph Nakazawa** - JS Infra
  - GitHub: [@cpojer](https://github.com/cpojer) · X: [@cnakazawa](https://x.com/cnakazawa)

- **Gustavo Madeira Santana** - Multi-agents, CLI, web UI
  - GitHub: [@gumadeiras](https://github.com/gumadeiras) · X: [@gumadeiras](https://x.com/gumadeiras)

## Development Setup

```sh
pnpm bootstrap   # fresh clone (links binaries first, then full install)
pnpm build
```

If your dependencies are already installed and you just need a normal reinstall:

```sh
pnpm install
```

### Windows / fresh-clone bootstrapping

The `prepare` lifecycle script runs during `pnpm install` and requires `tsx` to already be linked — a chicken-and-egg on a fresh clone. Use the bootstrap script instead:

```sh
pnpm bootstrap
```

This runs `pnpm install --ignore-scripts` first (links binaries including `tsx`), then `pnpm install` normally.

If you only need to update `pnpm-lock.yaml` without downloading packages:

```sh
pnpm install --lockfile-only
```

## How to Contribute

1. **Bugs & small fixes** → Open a PR!
2. **New features / architecture** → Start a [GitHub Discussion](https://github.com/seanhogg/builderforce/discussions) or ask in Discord first
3. **Questions** → Discord #setup-help

## Before You PR

- Test locally with your BuilderForce Agents instance
- Run tests: `pnpm build && pnpm check && pnpm test`
- Ensure CI checks pass
- Keep PRs focused (one thing per PR; do not mix unrelated concerns)
- Describe what & why
- **Never manually edit `version` in `package.json`** — use `pnpm release` (or `pnpm plugins:sync` after a root version bump) to keep all extension versions in sync. CI will fail if versions diverge.
- **Never add `Co-Authored-By` trailers** to commit messages — not for AI tools, not for anything. Keep commit messages clean.

## Control UI Decorators

The Control UI uses Lit with **legacy** decorators (current Rollup parsing does not support
`accessor` fields required for standard decorators). When adding reactive fields, keep the
legacy style:

```ts
@state() foo = "bar";
@property({ type: Number }) count = 0;
```

The root `tsconfig.json` is configured for legacy decorators (`experimentalDecorators: true`)
with `useDefineForClassFields: false`. Avoid flipping these unless you are also updating the UI
build tooling to support standard decorators.

## AI/Vibe-Coded PRs Welcome! 🤖

Built with Codex, Claude, or other AI tools? **Awesome - just mark it!**

Please include in your PR:

- [ ] Mark as AI-assisted in the PR title or description
- [ ] Note the degree of testing (untested / lightly tested / fully tested)
- [ ] Include prompts or session logs if possible (super helpful!)
- [ ] Confirm you understand what the code does

AI PRs are first-class citizens here. We just want transparency so reviewers know what to look for.

## Current Focus & Roadmap 🗺

We are currently prioritizing:

- **Stability**: Fixing edge cases in channel connections (WhatsApp/Telegram).
- **UX**: Improving the onboarding wizard and error messages.
- **Skills**: For skill contributions, head to [AgentHub](https://agenthub.ai/) — the community hub for BuilderForce Agents skills.
- **Performance**: Optimizing token usage and compaction logic.

Check the [GitHub Issues](https://github.com/seanhogg/builderforce/issues) for "good first issue" labels!

## Maintainers

We're selectively expanding the maintainer team.
If you're an experienced contributor who wants to help shape BuilderForce Agents's direction — whether through code, docs, or community — we'd like to hear from you.

Being a maintainer is a responsibility, not an honorary title. We expect active, consistent involvement — triaging issues, reviewing PRs, and helping move the project forward.

Still interested? Email contributing@builderforce.ai with:

- Links to your PRs on BuilderForce Agents (if you don't have any, start there first)
- Links to open source projects you maintain or actively contribute to
- Your GitHub, Discord, and X/Twitter handles
- A brief intro: background, experience, and areas of interest
- Languages you speak and where you're based
- How much time you can realistically commit

We welcome people across all skill sets — engineering, documentation, community management, and more.
We review every human-only-written application carefully and add maintainers slowly and deliberately.
Please allow a few weeks for a response.

## Releasing

Releases follow the **`YYYY.M.D[-beta.N]`** version scheme (e.g. `2026.2.23-beta.1`).

### Steps

1. **Run the release script** — handles version bump, CHANGELOG scaffolding, and validation:

   ```sh
   pnpm release                    # interactive prompt
   pnpm release -- --dry-run       # preview only (writes nothing)
   ```

   The script will:
   - Suggest the next version based on today's date and the current version
   - Prompt for changelog entries (Changes / Breaking / Fixes)
   - Bump `version` in `package.json` and `CHANGELOG.md`
   - Run `pnpm plugins:sync` to align all extension versions
   - Optionally bump iOS / Android / macOS native app version strings
   - Run **`pnpm format`** (auto-fix) then **`pnpm check`** (format + types + lint) — CI will reject unformatted code
   - Run `pnpm release:check` to validate the dist pack
   - Optionally `git commit` and `git tag`

2. **Push** — after the script commits and tags:

   ```sh
   git push && git push --tags
   ```

3. **Publish** (if applicable) — `pnpm publish` or the CI publish workflow picks up the tag.

### Version Format

| Pattern           | Example           | Use                   |
| ----------------- | ----------------- | --------------------- |
| `YYYY.M.D`        | `2026.3.1`        | Stable release        |
| `YYYY.M.D-beta.N` | `2026.3.1-beta.1` | Pre-release / testing |

### Manual sub-steps

If you need to run individual steps by hand:

```sh
# 1. Sync extension versions to the new root version
pnpm plugins:sync

# 2. Validate the npm pack (dist files, no forbidden paths, version alignment)
pnpm release:check
```

---

## Report a Vulnerability

We take security reports seriously. Report vulnerabilities directly to the repository where the issue lives:

- **Core CLI and gateway** — [builderforce/builderforce](https://github.com/seanhogg/builderforce)
- **macOS desktop app** — [builderforce/builderforce](https://github.com/seanhogg/builderforce) (apps/macos)
- **iOS app** — [builderforce/builderforce](https://github.com/seanhogg/builderforce) (apps/ios)
- **Android app** — [builderforce/builderforce](https://github.com/seanhogg/builderforce) (apps/android)
- **AgentHub** — [builderforce/agenthub](https://github.com/builderforce/agenthub)
- **Trust and threat model** — [builderforce/trust](https://github.com/builderforce/trust)

For issues that don't fit a specific repo, or if you're unsure, email **security@builderforce.ai** and we'll route it.

### Required in Reports

1. **Title**
2. **Severity Assessment**
3. **Impact**
4. **Affected Component**
5. **Technical Reproduction**
6. **Demonstrated Impact**
7. **Environment**
8. **Remediation Advice**

Reports without reproduction steps, demonstrated impact, and remediation advice will be deprioritized. Given the volume of AI-generated scanner findings, we must ensure we're receiving vetted reports from researchers who understand the issues.
