/**
 * The `agents` extra: three role-declared agents (coordinator, developer, tester) with
 * their briefs under `agents/`, and the `capabilities.agents` ceilings they narrow.
 * The shapes are the manifest's own (`AgentsPolicy`, `AgentDeclaration` in
 * builderforce-webcontainers `core/src/manifest/types.ts`): agents are declared by
 * role, never a model id, and a declaration above a ceiling is refused, not clamped.
 */
import type { KitAgentDeclaration, KitPart } from '../types';

/** Where the briefs live, from the project root. */
const BRIEF_DIR = 'agents';
const briefPath = (role: string) => `${BRIEF_DIR}/${role}.md`;

/** The environment tools (`ENV_TOOL_KEYS` in core `agents/contract.ts`) an agent may be given. */
const READ = 'env.fs.read';
const WRITE = 'env.fs.write';
const LIST = 'env.fs.list';
const RUN = 'env.run';
const PREVIEW = 'env.preview.fetch';
const STATUS = 'env.services.status';

/** Ceilings every declaration stays within. */
const AGENT_CEILING = {
  maxAgents: 3,
  maxDepth: 1,
  maxChildren: 2,
  tools: [READ, WRITE, LIST, RUN, PREVIEW, STATUS],
  budget: { tokens: 200_000, usd: 5, steps: 100 },
};

const agent = (role: string, tools: string[], budget: KitAgentDeclaration['budget']): KitAgentDeclaration => ({
  role,
  instructions: briefPath(role),
  tools,
  budget,
});

const BRIEFS: Readonly<Record<string, string>> = {
  coordinator: `# Coordinator

You split the task into small pieces, hand each to the developer or the tester, and report the outcome.

- Read and list files to understand the project (\`env.fs.read\`, \`env.fs.list\`); check the services with \`env.services.status\`.
- You do not edit files or run commands.
- Finish with a short report: what was done, what failed, what is left.
`,
  developer: `# Developer

You make the change you are given.

- Edit code with \`env.fs.read\`, \`env.fs.write\` and \`env.fs.list\`; keep each change small.
- Run builds and scripts with \`env.run\` to check your work.
- Report the files you changed and anything you could not finish.
`,
  tester: `# Tester

You check that the app works.

- Run the test suite with \`env.run\` and read the results with \`env.fs.read\`.
- Fetch the running app with \`env.preview.fetch\` and check the services with \`env.services.status\`.
- Do not change code; report each failure with the command, the output and the file involved.
`,
};

export const AGENTS: KitPart = {
  id: 'agents',
  kind: 'extra',
  label: 'AI agents (coordinator, developer, tester)',
  aliases: ['agent'],
  // No service of its own: the briefs sit at the project's `agents/` folder.
  serviceId: 'api',
  root: '/agents',
  files: Object.fromEntries(Object.entries(BRIEFS).map(([role, brief]) => [`${role}.md`, brief])),
  manifest: {
    capabilities: { agents: AGENT_CEILING },
    agents: {
      coordinator: agent('coordinator', [READ, LIST, STATUS], { tokens: 100_000, usd: 2, steps: 50 }),
      developer: agent('developer', [READ, WRITE, LIST, RUN], AGENT_CEILING.budget),
      tester: agent('tester', [READ, LIST, RUN, PREVIEW, STATUS], { tokens: 100_000, usd: 2, steps: 50 }),
    },
  },
};
