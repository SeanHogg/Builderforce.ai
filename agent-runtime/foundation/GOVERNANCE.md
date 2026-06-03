# Governance (Foundation Component)

Governance rules are a first‑class part of the BuilderForce Agents foundation.
They live in a Markdown document (`governance.md`) inside the
project‑scoped `.BuilderForce Agents` directory and provide high‑level policies
that agents consult when making decisions. Typical guidance includes
approval criteria, security boundaries, communication standards, and
legal disclaimers.

The foundation repository includes this file to make governance visible
when onboarding a new workspace. The CLI and APIs automatically create a
placeholder during project initialization.

## Initialization behaviour

When you run `initializeBuilderForce AgentsProject()` (or the equivalent CLI
commands) the following files are created under `.builderforce/`:

- `context.yaml` – project metadata and environment details
- `architecture.md` – architecture notes
- `rules.yaml` – coding standards and lint/test requirements
- **`governance.md` – project governance rules (this file)**
- `personas/`, `skills/`, `memory/`, `sessions/` directories

The default governance template explains its purpose and can be
edited immediately by any contributor.

## Making governance foundational

Because governance affects how all agents behave, it deserves a place in
`/foundation`. Copy this file into your project or link to it during
onboarding to remind teams to customize their policies early.
