/**
 * Builtin skill bodies — canonical instructions for the skills the self-hosted
 * runtime ships locally (e.g. `github`, `coding-agent`) but which have no row in
 * `marketplace_skills`. The cloud capability loader falls back to this registry
 * so a cloud agent honors an assigned builtin skill with real instructions, at
 * parity with a self-hosted host (which loads them via the gateway
 * `artifacts.sync`) — instead of only referencing the skill by name.
 *
 * Keep these concise: they prepend to the agent's system prompt. Slugs are the
 * assigned artifact slugs (see resolveArtifacts) and are matched case-insensitively.
 */

export interface BuiltinSkillBody {
  name: string;
  description: string;
  readme: string;
}

const BUILTIN_SKILLS: Record<string, BuiltinSkillBody> = {
  github: {
    name: 'GitHub',
    description: 'Work with the bound GitHub repository: read existing code, make minimal correct edits, and ship via the ticket branch.',
    readme: [
      'Use the repository tools to ground every change in the real codebase:',
      '- Call list_files first to learn the project layout and conventions.',
      '- read_file any file before editing it; preserve existing code and only change what the task requires.',
      '- write_file with the FULL updated content (never placeholders or elisions).',
      'Match the surrounding code: imports, naming, formatting, and patterns already in the repo.',
      'Keep changes scoped to the task; do not refactor unrelated code. Your committed changes are merged to the deploy branch, so they must be complete and correct.',
    ].join('\n'),
  },
  'coding-agent': {
    name: 'Coding Agent',
    description: 'Implement software changes end-to-end: understand the task, edit the codebase, and deliver working, reviewable code.',
    readme: [
      'Operate like a careful senior engineer:',
      '1. Understand the task and the PRD before writing anything.',
      '2. Explore the codebase (list_files / read_file) to find where the change belongs and how similar things are done.',
      '3. Make the smallest correct change that satisfies the acceptance criteria; reuse existing helpers/components instead of duplicating logic.',
      '4. Write complete file contents, keep the build green (no obvious type/import errors), and avoid leaving dead code.',
      '5. Summarize what you changed and why when you finish.',
    ].join('\n'),
  },
  'code-review': {
    name: 'Code Review',
    description: 'Review changes for correctness, security, and simplicity before they ship.',
    readme: [
      'When reviewing or before finishing your own change, check: correctness (does it do what the task asks, edge cases handled), reuse/duplication (is there an existing helper), security (no leaked secrets, validated inputs), and clarity (matches surrounding style).',
      'Flag anything you could not verify rather than asserting it works.',
    ].join('\n'),
  },
  'test-generator': {
    name: 'Test Generator',
    description: 'Write focused tests that cover the behavior changed by the task.',
    readme: [
      'Add or update tests alongside code changes: cover the new behavior and at least one edge/failure case.',
      'Follow the project’s existing test framework and file conventions (look for sibling *.test.* files).',
    ].join('\n'),
  },
};

/** Look up a builtin skill body by slug (case-insensitive). Null when not builtin. */
export function getBuiltinSkillBody(slug: string): BuiltinSkillBody | null {
  return BUILTIN_SKILLS[slug.trim().toLowerCase()] ?? null;
}
