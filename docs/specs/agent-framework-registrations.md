# Agent framework registrations

Builderforce registers callable runtimes in `agent_registrations`. A registration's
`framework` identifies the implementation and its `protocol` identifies the wire
contract. Framework names are slugs rather than a database enum, so adding a new
framework does not require a schema migration.

## Supported integration paths

| Framework | Preferred protocol |
| --- | --- |
| LangGraph | A2A |
| Microsoft Agent Framework | A2A |
| Google ADK | A2A |
| Pydantic AI | Builderforce Worker |
| CrewAI | Builderforce Worker |
| OpenAI Agents SDK | Builderforce Worker |
| Claude | ACP, Builderforce Worker, or native HTTP |
| OpenClaw | Builderforce Worker or native HTTP |
| Hermes | ACP or native HTTP |

The live catalog is returned by `GET /api/agent-registrations/frameworks`.

## Registration lifecycle

1. A manager calls `POST /api/agent-registrations` with a name, framework,
   protocol, and either a public endpoint or an `agentHostId`.
2. The runtime or its bound AgentHost calls
   `POST /api/agent-registrations/{id}/capabilities` with discovered capability
   slugs, health, and an optional Agent Card.
3. Dispatch clients use the registration UUID as `agentRegistrationId` on
   `POST /api/runtime/executions`.
4. `DELETE /api/agent-registrations/{id}` deactivates the registration without
   deleting execution history.

Declared capabilities express what an operator permits/configures. Discovered
capabilities express what the runtime reports. The API returns their deduplicated
union as `capabilities` while retaining both source lists for governance.

`credentialRef` accepts only opaque `vault:` or `integration:` references. Secrets
must never be placed in a registration, endpoint URL, Agent Card, or metadata.

## Legacy table deprecation

Migration `0394_agent_registrations.sql` backfills every legacy `agents` row and its
skill names, adds canonical registration references to executions and dispatches,
and leaves the old foreign keys nullable for historical reads. `POST /api/agents`
and `POST /api/agents/{id}/skills` return `410 Gone`; legacy reads include
`Deprecation`, `Sunset`, and successor `Link` headers.

Do not drop `agents`, `skills`, or their old foreign-key columns until production
contains no execution/dispatch row that lacks `agent_registration_id` and all
released clients use `/api/agent-registrations`.
