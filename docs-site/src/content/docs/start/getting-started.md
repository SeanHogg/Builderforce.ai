---
summary: "Get BuilderForce Agents installed and run your first chat in minutes."
read_when:
  - First time setup from zero
  - You want the fastest path to a working chat
title: "Getting Started"
---

# Getting Started

Goal: go from zero to a first working chat with minimal setup.

<Info>
Fastest chat: open the Control UI (no channel setup needed). Run `builderforce dashboard`
and chat in the browser, or open `http://127.0.0.1:18789/` on the
<Tooltip headline="Gateway host" tip="The machine running the BuilderForce Agents gateway service.">gateway host</Tooltip>.
Docs: [Dashboard](/web/dashboard) and [Control UI](/web/control-ui).
</Info>

## Prereqs

- Node 22 or newer

<Tip>
Check your Node version with `node --version` if you are unsure.
</Tip>

## Quick setup (CLI)

<Steps>
  <Step title="Install BuilderForce Agents (recommended)">
    <Tabs>
      <Tab title="macOS/Linux">
        ```bash
        curl -fsSL https://builderforce.ai/install.sh | bash
        ```
        <img
  src="/assets/install-script.svg"
  alt="Install Script Process"
  className="rounded-lg"
/>
      </Tab>
      <Tab title="Windows (PowerShell)">
        ```powershell
        iwr -useb https://builderforce.ai/install.ps1 | iex
        ```
      </Tab>
    </Tabs>

    <Note>
    Other install methods and requirements: [Install](/install).
    Built on [BuilderForce Agents](https://github.com/SeanHogg/Builderforce.ai)'s multi-channel gateway with Phase 2 enhancements.
    </Note>

  </Step>
  <Step title="Run the onboarding wizard">
    ```bash
    builderforce onboard --install-daemon
    ```

    The wizard configures auth, gateway settings, and optional channels.
    See [Onboarding Wizard](/start/wizard) for details.

  </Step>
  <Step title="Check the Gateway">
    If you installed the service, it should already be running:

    ```bash
    builderforce gateway status
    ```

  </Step>
  <Step title="Open the Control UI">
    ```bash
    builderforce dashboard
    ```
  </Step>
</Steps>

<Check>
If the Control UI loads, your Gateway is ready for use.
</Check>

## Optional checks and extras

<AccordionGroup>
  <Accordion title="Run the Gateway in the foreground">
    Useful for quick tests or troubleshooting.

    ```bash
    builderforce gateway --port 18789
    ```

  </Accordion>
  <Accordion title="Send a test message">
    Requires a configured channel.

    ```bash
    builderforce message send --target +15555550123 --message "Hello from BuilderForce Agents"
    ```

  </Accordion>
</AccordionGroup>

## Useful environment variables

If you run BuilderForce Agents as a service account or want custom config/state locations:

- `BUILDERFORCE_AGENTS_HOME` sets the home directory used for internal path resolution.
- `BUILDERFORCE_AGENTS_STATE_DIR` overrides the state directory.
- `BUILDERFORCE_AGENTS_CONFIG_PATH` overrides the config file path.

Full environment variable reference: [Environment vars](/help/environment).

## BuilderForce Agents dev workflows (quick start)

Once your Gateway is running, initialize BuilderForce Agents in any project and start running multi-agent workflows.

<Steps>
  <Step title="Initialize your project">
    ```bash
    cd my-project
    builderforce init
    ```

    This creates a `.builderforce/` directory with persistent project context:

    ```
    .builderforce/
    ├── context.yaml    # project metadata (languages, frameworks, dependencies)
    ├── architecture.md # design docs
    ├── rules.yaml      # coding standards
    ├── agents/         # custom agent roles
    ├── skills/         # project-specific skills
    ├── memory/         # knowledge base
    └── sessions/       # session handoff docs
    ```

  </Step>
  <Step title="Plan a major feature">
    Run the **Planning workflow** before writing any code. It produces a PRD, architecture spec, and ordered task list.

    ```bash
    builderforce agent --message "Plan a real-time collaboration feature" --thinking high
    ```

  </Step>
  <Step title="Build with multi-agent workflows">
    ```bash
    # Feature: Architecture Advisor → Code Creator → Test Generator + Code Reviewer
    builderforce agent --message "Implement the authentication module" --thinking high

    # Bug fix: Bug Analyzer → Code Creator → Test Generator + Code Reviewer
    builderforce agent --message "Fix the memory leak in the parser" --thinking high

    # Adversarial review (built-in critique pass):
    builderforce agent --message "Adversarially review the API design" --thinking high
    ```

  </Step>
  <Step title="Save a session handoff">
    At the end of each session, save a handoff so the next one resumes instantly.

    ```bash
    builderforce agent --message "Save a session handoff for today's work" --thinking low
    ```

    BuilderForce Agents writes a structured YAML to `.builderforce/sessions/` covering decisions, next steps, and open questions. The next session loads it automatically.

  </Step>
</Steps>

Full workflow reference: [BuilderForce Agents Workflows](/agents-workflows)

## Go deeper

<Columns>
  <Card title="Onboarding Wizard (details)" href="/start/wizard">
    Full CLI wizard reference and advanced options.
  </Card>
  <Card title="macOS app onboarding" href="/start/onboarding">
    First run flow for the macOS app.
  </Card>
</Columns>

## What you will have

- A running Gateway
- Auth configured
- Control UI access or a connected channel

## Next steps

- BuilderForce Agents Phase 2 Features: [Phase 2 Documentation](/phase2)
- DM safety and approvals: [Pairing](/channels/pairing)
- Connect more channels: [Channels](/channels)
- Advanced workflows and from source: [Setup](/start/setup)
