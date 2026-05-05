---
title: Skills Marketplace
description: Publish, discover, and install reusable AI agent skills at tenant or claw level
---

# Skills Marketplace

The coderClaw.ai Skills Marketplace is the **public registry for reusable AI agent capabilities**. Publish skills your agents use, discover skills built by the community, and install them in one click — at the tenant or claw level.

---

## 1. What is a Skill?

A **skill** is a self-contained capability that a coderClaw agent can use. Skills extend what agents can do without modifying the core agent runtime.

Examples:
- `ts-linter` — runs ESLint + type-check on changed TypeScript files
- `pr-reviewer` — analyses a pull request diff and posts a structured review
- `test-generator` — generates Jest or Vitest tests for a function or module
- `doc-writer` — creates JSDoc or Markdown documentation from source code
- `security-scanner` — runs a SAST scan on modified files

Skills are described by a name, slug, description, category, tags, version, README, and an optional icon and repository URL. The actual skill implementation lives in the coderClaw project's `.coderClaw/skills/` directory or in a linked GitHub repository.

---

## 2. Browsing the Marketplace

Visit the **Skills** view in the portal (`builderforce.ai/skills`) or query the API directly:

```http
GET /marketplace/skills
GET /marketplace/skills?category=code-quality
GET /marketplace/skills?q=typescript+linter&page=1&limit=24
```

Skills are sorted by **downloads then likes** (most popular first). Each skill card shows:
- Name, slug, description, category, tags
- Author username and avatar
- Download count and like count
- Version

---

## 3. Creating a Marketplace Account

The Marketplace uses a **separate auth system** from the orchestration API (email + password → JWT, no API key required). This lets anyone publish skills without needing a paid tenant.

```http
POST /marketplace/auth/register
Content-Type: application/json

{
  "email": "dev@example.com",
  "username": "my-handle",
  "password": "strong-password",
  "display_name": "My Name"
}
```

**Response 201:**
```json
{ "token": "<marketplace-jwt>", "user": { "id": "…", "email": "…", "username": "my-handle" } }
```

Store the token and include it as `Authorization: Bearer <token>` on all authenticated marketplace requests.

To log in on a subsequent session:
```http
POST /marketplace/auth/login
{ "email": "dev@example.com", "password": "strong-password" }
```

---

## 4. Publishing a Skill

Once you have a marketplace JWT:

```http
POST /marketplace/skills
Authorization: Bearer <marketplace-jwt>
Content-Type: application/json

{
  "name": "TypeScript Linter",
  "slug": "ts-linter",
  "description": "Runs ESLint and tsc --noEmit on modified TypeScript files and returns structured findings.",
  "category": "code-quality",
  "tags": ["typescript", "eslint", "linting"],
  "version": "1.0.0",
  "readme": "# TypeScript Linter\n\nInstall with...",
  "icon_url": "https://example.com/icon.png",
  "repo_url": "https://github.com/myuser/ts-linter-skill"
}
```

The skill is created in **unpublished** state. Set `published: true` to make it visible:

```http
PUT /marketplace/skills/ts-linter
Authorization: Bearer <marketplace-jwt>

{ "published": true }
```

---

## 5. Versioning and Updates

Update a skill at any time with `PUT /marketplace/skills/:slug`. Bump the `version` field to signal a new release. There is no automatic version enforcement — use semver by convention. Breaking changes should bump the major version.

---

## 6. Installing a Skill

Skills are installed via the **Skill Assignments** API, not the Marketplace API. The Marketplace API is for browsing and publishing; Skill Assignments link a marketplace skill to a tenant or claw.

```http
# Install at tenant level (all claws inherit)
POST /api/skill-assignments/tenant
Authorization: Bearer <user-jwt>
Content-Type: application/json

{ "slug": "ts-linter" }

# Install on a specific claw only
POST /api/skill-assignments/claws/42
Authorization: Bearer <user-jwt>

{ "slug": "ts-linter" }
```

The coderClaw runtime discovers its assigned skills on the next sync and loads the skill implementation from `.coderClaw/skills/` or the linked repository.

---

## 7. Skill Scoping: Tenant vs Claw

| Scope | API path | When to use |
|-------|----------|-------------|
| **Tenant** | `/api/skill-assignments/tenant` | Skill is useful for all claws (e.g. a linter, a PR reviewer) |
| **Claw** | `/api/skill-assignments/claws/:clawId` | Skill is specific to one claw's role (e.g. a deployment skill on the CI claw only) |

Claw-level assignments override tenant-level for the same slug — a claw can have a different version of a skill than the tenant default.

---

## 8. Skill Categories

| Category | Description |
|----------|-------------|
| `code-quality` | Linters, formatters, static analysis |
| `testing` | Test generators, coverage reporters |
| `documentation` | Doc writers, README generators |
| `security` | SAST scanners, dependency audits |
| `devops` | CI/CD integrations, deployment scripts |
| `review` | PR reviewers, code critique tools |
| `refactoring` | Refactor helpers, dead-code detectors |
| `architecture` | Diagram generators, dependency graph tools |
| `monitoring` | Error trackers, performance profilers |
| `other` | Everything else |

---

## 9. API Reference

See the full endpoint list in [API Reference — Marketplace](/link/api-reference/#marketplace) and [API Reference — Skill Assignments](/link/api-reference/#skill-assignments).

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/marketplace/skills` | None | Browse published skills |
| `GET` | `/marketplace/skills/:slug` | None | Get skill detail |
| `POST` | `/marketplace/skills` | Marketplace JWT | Publish skill |
| `PUT` | `/marketplace/skills/:slug` | Marketplace JWT | Update own skill |
| `POST` | `/marketplace/skills/:slug/like` | Marketplace JWT | Toggle like |
| `POST` | `/api/skill-assignments/tenant` | User JWT (MANAGER+) | Install at tenant level |
| `POST` | `/api/skill-assignments/claws/:id` | User JWT (MANAGER+) | Install on claw |
| `DELETE` | `/api/skill-assignments/tenant/:slug` | User JWT (MANAGER+) | Remove tenant assignment |
| `DELETE` | `/api/skill-assignments/claws/:id/:slug` | User JWT (MANAGER+) | Remove claw assignment |
