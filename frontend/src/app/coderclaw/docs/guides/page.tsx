import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Guides — CoderClaw Docs',
  description: 'Comprehensive guides for CoderClaw — agents, sub-agents, mesh orchestration, and best practices.',
  alternates: { canonical: '/coderclaw/docs/guides' },
};

export default function GuidesPage() {
  return (
    <>
      <h1>Comprehensive Guides</h1>
      <p className="lead">Master the advanced features of CoderClaw with in-depth guides and tutorials.</p>

      <section id="agents">
        <h2>Creating Agents</h2>
        <p>
          Agents are the core building blocks of CoderClaw. Learn how to create, configure, and deploy autonomous agents
          that handle complex coding tasks.
        </p>
        <h3>Agent Configuration</h3>
        <p>When creating an agent, you can configure several parameters to control its behavior:</p>
        <ul>
          <li><strong>Model:</strong> The LLM to use (e.g., claude-opus, gpt-4)</li>
          <li><strong>Instructions:</strong> System prompt defining agent behavior</li>
          <li><strong>Tools:</strong> Available functions the agent can call</li>
          <li><strong>Memory:</strong> How the agent remembers previous interactions</li>
          <li><strong>Timeout:</strong> Maximum execution time</li>
        </ul>
        <h3>Best Practices</h3>
        <ul>
          <li>Write clear, concise instructions for your agents</li>
          <li>Give agents specific tools to reduce hallucination</li>
          <li>Monitor agent performance and iterate on instructions</li>
          <li>Use sub-agents for complex, multi-step tasks</li>
        </ul>
      </section>

      <section id="subagents">
        <h2>Working with Sub-Agents</h2>
        <p>
          Sub-agents allow you to break complex tasks into smaller, manageable pieces. A parent agent can create and orchestrate
          multiple sub-agents working in parallel.
        </p>
        <h3>When to Use Sub-Agents</h3>
        <ul>
          <li>Breaking down large projects into independent components</li>
          <li>Handling specialized subtasks in parallel</li>
          <li>Creating hierarchical task structures</li>
          <li>Improving performance through parallelization</li>
        </ul>
        <h3>Creating Sub-Agents</h3>
        <p>
          Sub-agents are created dynamically by parent agents as needed. The parent agent communicates with sub-agents
          through defined interfaces and monitors their progress.
        </p>
      </section>

      <section id="orchestration">
        <h2>Mesh Orchestration with Builderforce.ai</h2>
        <p>
          Builderforce.ai is the mesh orchestration layer that connects and coordinates multiple agents, projects, and services.
        </p>
        <h3>Core Concepts</h3>
        <ul>
          <li><strong>Mesh Network:</strong> A network of interconnected agents</li>
          <li><strong>Service Discovery:</strong> Automatic agent discovery and registration</li>
          <li><strong>Message Bus:</strong> Reliable inter-agent communication</li>
          <li><strong>Orchestration Engine:</strong> Centralized coordination</li>
        </ul>
        <h3>Getting Started with Builderforce</h3>
        <p>Access the <Link href="/">Builderforce dashboard</Link> to:</p>
        <ul>
          <li>Visualize your agent network</li>
          <li>Monitor agent health and performance</li>
          <li>Configure mesh topology</li>
          <li>Manage deployments</li>
        </ul>
      </section>

      <section>
        <h2>More Resources</h2>
        <p>
          For detailed API documentation and examples, see the <a href="/coderclaw/docs/api-reference">API Reference</a>{' '}
          and <a href="/coderclaw/docs/examples">Examples</a> sections.
        </p>
      </section>
    </>
  );
}
