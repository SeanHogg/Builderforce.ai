---
title: "Submitting a PR"
summary: "What we expect from contributors opening pull requests."
---

# Submitting a PR

Thanks for contributing to CoderClaw! Here's what we expect before you open a pull request.

## Before You Open a PR

- **Test locally** — run your changes against a real CoderClaw instance
- **Run the full gate:**
  ```sh
  pnpm build && pnpm check && pnpm test
  ```
- **Ensure CI checks pass** — the gate must be green before requesting review
- **Keep PRs focused** — one thing per PR; do not mix unrelated concerns
- **Describe what and why** — the PR description should explain _what_ you changed and _why_
- **Never manually edit `version` in `package.json`** — use `pnpm release` (or `pnpm plugins:sync` after a root version bump) to keep all extension versions in sync

## AI / Vibe-Coded PRs

Built with Codex, Claude, or other AI tools? **Awesome — just mark it.**

Please include in your PR description:

- Mark as AI-assisted in the PR title or description
- Note the degree of testing (untested / lightly tested / fully tested)
- Include prompts or session logs if possible
- Confirm you understand what the code does

AI PRs are first-class citizens here. We just need transparency so reviewers know what to look for.

## Changelog

Every user-facing change must have a changelog entry. Add it to `CHANGELOG.md` under the appropriate section:

- **Changes** — new features, enhancements
- **Fixes** — bug fixes
- **Breaking** — anything that breaks existing config or behavior

Format:

```
- Feature/fix short description. (#PR_NUMBER) Thanks @yourhandle. https://docs.coderclaw.ai/...
```

If there's a relevant docs URL, include it. If there isn't one yet, leave it out.

## PR Scope

- **Bugs and small fixes** — open a PR directly
- **New features / architecture** — start a [GitHub Discussion](https://github.com/seanhogg/coderclaw/discussions) or ask in Discord first
- **Questions** — Discord `#setup-help`

## Control UI Decorators

The Control UI uses Lit with **legacy** decorators (current Rollup parsing does not support `accessor` fields required for standard decorators). When adding reactive fields, keep the legacy style:

```ts
@state() foo = "bar";
@property({ type: Number }) count = 0;
```

The root `tsconfig.json` is configured for legacy decorators (`experimentalDecorators: true`) with `useDefineForClassFields: false`. Avoid flipping these unless you are also updating the UI build tooling to support standard decorators.

## Review Checklist

- [ ] Locally tested with a real CoderClaw instance
- [ ] `pnpm build && pnpm check && pnpm test` passes
- [ ] Changelog entry added (if user-facing)
- [ ] PR description explains what and why
- [ ] No unrelated changes included
- [ ] AI-assistance declared (if applicable)
- [ ] Versions not manually bumped in `package.json`

## See Also

- [Contributing Guide](https://github.com/seanhogg/coderclaw/blob/main/CONTRIBUTING.md)
- [Project overview](/coderclaw-overview)
- [Discord](https://discord.gg/coderclaw) — `#setup-help` for questions
