---
summary: "CLI reference for `builderforce skills` (list/info/check) and skill eligibility"
read_when:
  - You want to see which skills are available and ready to run
  - You want to debug missing binaries/env/config for skills
title: "skills"
---

# `builderforce skills`

Inspect skills (bundled + workspace + managed overrides) and see what’s eligible vs missing requirements.

Related:

- Skills system: [Skills](/tools/skills)
- Skills config: [Skills config](/tools/skills-config)
- AgentHub installs: [AgentHub](/tools/agenthub)

## Commands

```bash
builderforce skills list
builderforce skills list --eligible
builderforce skills info <name>
builderforce skills check
```
