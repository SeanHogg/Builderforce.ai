import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Getting Started — CoderClaw Docs',
  description: 'Get up and running with CoderClaw in minutes. Install the CLI, create your first autonomous agent, and start orchestrating sub-agents with Builderforce.ai.',
  alternates: { canonical: '/coderclaw/docs/getting-started' },
};

export default function GettingStartedPage() {
  return (
    <>
      <h1>Getting Started with CoderClaw</h1>
      <p className="lead">Welcome to CoderClaw. This guide gets you up and running with the multi-agent coding framework in a few minutes.</p>

      <section>
        <h2>What is CoderClaw?</h2>
        <p>
          CoderClaw is an advanced framework for building autonomous coding agents that can manage complex development tasks independently.
          With CoderClaw, you transition from writing code to orchestrating intelligent agents that handle the work for you.
        </p>
        <p>At its core, CoderClaw enables you to:</p>
        <ul>
          <li>Create autonomous agents that code independently</li>
          <li>Manage multiple sub-agents working in parallel</li>
          <li>Orchestrate agent interactions via Builderforce.ai mesh network</li>
          <li>Monitor and control agent behavior in real-time</li>
        </ul>
      </section>

      <section id="installation">
        <h2>Installation</h2>
        <p>Get CoderClaw up and running on your system:</p>
        <pre><code>curl -fsSL https://coderclaw.ai/install.sh | bash</code></pre>
        <p>Or using the CLI directly:</p>
        <pre><code>npm install -g coderclaw</code></pre>
      </section>

      <section id="first-agent">
        <h2>Your First Agent</h2>
        <p>Create a simple agent that performs basic code analysis:</p>
        <pre><code>{`import { Agent } from 'coderclaw';

const agent = new Agent({
  name: 'CodeAnalyzer',
  model: 'claude-opus',
  instructions: 'You are an expert code analyzer. Review code and provide detailed feedback.'
});

const result = await agent.run({
  task: 'Analyze this code and suggest improvements',
  input: 'const x = 1 + 2 + 3;'
});

console.log(result);`}</code></pre>
        <p>That&apos;s it. Your first agent is running. Learn more in the <a href="/coderclaw/docs/guides#agents">Creating Agents</a> guide.</p>
      </section>

      <section>
        <h2>Next Steps</h2>
        <ul>
          <li><a href="/coderclaw/docs/guides">Read the comprehensive guides</a> to learn advanced features</li>
          <li><a href="/coderclaw/docs/api-reference">Check the API reference</a> for detailed documentation</li>
          <li><a href="/coderclaw/docs/examples">Explore example projects</a> to see CoderClaw in action</li>
          <li><a href="/">Access the Builderforce dashboard</a> to manage your agents</li>
        </ul>
      </section>
    </>
  );
}
