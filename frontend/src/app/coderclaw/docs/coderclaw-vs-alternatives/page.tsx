import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'CoderClaw vs Alternatives — CoderClaw Docs',
  description: 'How CoderClaw compares to GitHub Copilot, Cursor, and Claude. Learn why CoderClaw is the only choice when you need autonomous, orchestrated agents.',
  alternates: { canonical: '/coderclaw/docs/coderclaw-vs-alternatives' },
};

interface Row {
  capability: string;
  cc: '✓' | '✗' | '~';
  copilot: '✓' | '✗' | '~';
  cursor: '✓' | '✗' | '~';
  claude: '✓' | '✗' | '~';
}

const rows: Row[] = [
  { capability: 'Autonomous agents', cc: '✓', copilot: '✗', cursor: '✗', claude: '✗' },
  { capability: 'Sub-agent orchestration', cc: '✓', copilot: '✗', cursor: '✗', claude: '✗' },
  { capability: 'Mesh networking (Builderforce.ai)', cc: '✓', copilot: '✗', cursor: '✗', claude: '✗' },
  { capability: 'Runs tasks while you sleep', cc: '✓', copilot: '✗', cursor: '✗', claude: '✗' },
  { capability: 'IDE integration', cc: '✓', copilot: '✓', cursor: '✓', claude: '✗' },
  { capability: 'In-line code completion', cc: '✗', copilot: '✓', cursor: '✓', claude: '✗' },
  { capability: 'Multi-model support', cc: '✓', copilot: '✗', cursor: '✓', claude: '✗' },
  { capability: 'Custom skills / tools', cc: '✓', copilot: '✗', cursor: '~', claude: '✗' },
  { capability: 'CLI-first workflow', cc: '✓', copilot: '✗', cursor: '✗', claude: '~' },
  { capability: 'Open / hackable install', cc: '✓', copilot: '✗', cursor: '✗', claude: '✗' },
  { capability: 'Business outcome focus', cc: '✓', copilot: '✗', cursor: '✗', claude: '✗' },
];

function Mark({ value }: { value: '✓' | '✗' | '~' }) {
  const color = value === '✓' ? 'var(--cyan-bright)' : value === '✗' ? 'rgba(255,107,107,0.7)' : 'var(--text-muted)';
  return <span style={{ color, fontWeight: 600 }}>{value}</span>;
}

export default function VsAlternativesPage() {
  return (
    <>
      <h1>CoderClaw vs Alternatives</h1>
      <p className="lead">
        Not all AI coding tools are built the same. Here&apos;s how CoderClaw compares to GitHub Copilot, Cursor, and Claude
        — and why CoderClaw is the only choice when you need autonomous, orchestrated agents.
      </p>

      <section>
        <h2>The Core Difference</h2>
        <p>
          Copilot, Cursor, and Claude are <strong>code assistants</strong> — they wait for you to ask, then generate a suggestion.
          CoderClaw is an <strong>autonomous agent framework</strong> — it takes a goal, breaks it down, spins up sub-agents,
          and completes real work while you focus on outcomes.
        </p>
        <p>
          The mental model shift: you stop being a developer who uses AI tools, and start being a manager who directs
          intelligent agents.
        </p>
      </section>

      <section>
        <h2>Feature Comparison</h2>
        <table>
          <thead>
            <tr>
              <th>Capability</th>
              <th style={{ color: 'var(--coral-bright)' }}>CoderClaw</th>
              <th>GitHub Copilot</th>
              <th>Cursor</th>
              <th>Claude</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.capability}>
                <td>{r.capability}</td>
                <td><Mark value={r.cc} /></td>
                <td><Mark value={r.copilot} /></td>
                <td><Mark value={r.cursor} /></td>
                <td><Mark value={r.claude} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>CoderClaw vs GitHub Copilot</h2>
        <p>
          Copilot is a productivity booster — it makes writing code faster by suggesting completions as you type. That&apos;s valuable,
          but it&apos;s fundamentally reactive. You drive every line.
        </p>
        <p>
          CoderClaw is proactive. You describe what needs to happen — <em>&ldquo;refactor the auth module, write tests, and open a PR&rdquo;</em> —
          and the agent handles it end-to-end. CoderClaw can also run overnight jobs, spawn parallel sub-agents for large tasks,
          and report back results via Builderforce.ai.
        </p>
        <p>
          <strong>Choose Copilot if</strong> you want autocomplete inside your editor.<br />
          <strong>Choose CoderClaw if</strong> you want an agent that completes whole tasks.
        </p>
      </section>

      <section>
        <h2>CoderClaw vs Cursor</h2>
        <p>
          Cursor is an AI-native editor with strong context awareness. It can read your codebase and make multi-file edits.
          It&apos;s a step beyond Copilot — but you&apos;re still in the driver&apos;s seat at all times.
        </p>
        <p>
          CoderClaw adds the orchestration layer that Cursor lacks. With CoderClaw you can define skills, wire agents together
          via Builderforce.ai mesh, and run complex pipelines that span multiple repositories, services, and environments — entirely unattended.
        </p>
        <p>
          <strong>Choose Cursor if</strong> you want a smarter editor.<br />
          <strong>Choose CoderClaw if</strong> you want agents that operate independently.
        </p>
      </section>

      <section>
        <h2>CoderClaw vs Claude</h2>
        <p>
          Claude (via Claude.ai or the API) is a powerful conversational AI. Developers use it for architectural discussions,
          code review, and problem-solving in chat. With Claude&apos;s computer use and code execution features it can take some
          direct actions, but it requires manual supervision.
        </p>
        <p>
          CoderClaw is built on top of models like Claude (and others). It wraps the model in an agent framework with persistent
          context, custom skills, mesh networking, and an opinionated CLI workflow — turning raw model capabilities into a
          production-ready autonomous coding system.
        </p>
        <p>
          <strong>Choose Claude if</strong> you want to chat your way through a problem.<br />
          <strong>Choose CoderClaw if</strong> you want that same intelligence working autonomously on your codebase.
        </p>
      </section>

      <section>
        <h2>Get Started</h2>
        <ul>
          <li><a href="/coderclaw/docs/getting-started">Quick start guide</a> — up and running in minutes</li>
          <li><a href="/coderclaw/docs/guides">Comprehensive guides</a> — agents, sub-agents, orchestration</li>
          <li><a href="/coderclaw/docs/examples">Examples</a> — real-world CoderClaw workflows</li>
          <li><a href="/">Builderforce dashboard</a> — manage your mesh</li>
        </ul>
      </section>
    </>
  );
}
