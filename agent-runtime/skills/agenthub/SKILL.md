---
name: agenthub
description: Use the AgentHub CLI to search, install, update, and publish agent skills from agenthub.com. Use when you need to fetch new skills on the fly, sync installed skills to latest or a specific version, or publish new/updated skill folders with the npm-installed agenthub CLI.
author: builderForceAgents
author-url: https://builderforce.ai
metadata:
  {
    "builderforce":
      {
        "requires": { "bins": ["agenthub"] },
        "install":
          [
            {
              "id": "node",
              "kind": "node",
              "package": "agenthub",
              "bins": ["agenthub"],
              "label": "Install AgentHub CLI (npm)",
            },
          ],
      },
  }
---

# AgentHub CLI

Install

```bash
npm i -g agenthub
```

Auth (publish)

```bash
agenthub login
agenthub whoami
```

Search

```bash
agenthub search "postgres backups"
```

Install

```bash
agenthub install my-skill
agenthub install my-skill --version 1.2.3
```

Update (hash-based match + upgrade)

```bash
agenthub update my-skill
agenthub update my-skill --version 1.2.3
agenthub update --all
agenthub update my-skill --force
agenthub update --all --no-input --force
```

List

```bash
agenthub list
```

Publish

```bash
agenthub publish ./my-skill --slug my-skill --name "My Skill" --version 1.2.0 --changelog "Fixes + docs"
```

Notes

- Default registry: https://agenthub.com (override with AGENTHUB_REGISTRY or --registry)
- Default workdir: cwd (falls back to BuilderForceAgents workspace); install dir: ./skills (override with --workdir / --dir / AGENTHUB_WORKDIR)
- Update command hashes local files, resolves matching version, and upgrades to latest unless --version is set
