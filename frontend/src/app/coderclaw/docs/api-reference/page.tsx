import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'API Reference — CoderClaw Docs',
  description: 'Complete API documentation for CoderClaw SDK and Builderforce.ai orchestration services.',
  alternates: { canonical: '/coderclaw/docs/api-reference' },
};

export default function ApiReferencePage() {
  return (
    <>
      <h1>API Reference</h1>
      <p className="lead">Complete API documentation for the CoderClaw SDK and Builderforce.ai orchestration services.</p>

      <section>
        <h2>Agent Class</h2>
        <p>The main class for creating and managing autonomous agents.</p>

        <h3>Constructor</h3>
        <pre><code>{`new Agent(config: AgentConfig)`}</code></pre>
        <p><strong>Parameters:</strong></p>
        <ul>
          <li><code>name</code> (string) — Unique agent identifier</li>
          <li><code>model</code> (string) — LLM model to use</li>
          <li><code>instructions</code> (string) — System prompt</li>
          <li><code>tools</code> (Tool[]) — Available tools/functions</li>
          <li><code>memory</code> (MemoryConfig) — Memory configuration</li>
        </ul>

        <h3>Methods</h3>
        <h4><code>run(task: Task): Promise&lt;Result&gt;</code></h4>
        <p>Execute a task with the agent.</p>
        <pre><code>{`const result = await agent.run({
  task: 'Analyze this code',
  input: codeString,
  timeout: 30000
});`}</code></pre>

        <h4><code>addTool(tool: Tool): void</code></h4>
        <p>Add a new tool/function to the agent&apos;s capabilities.</p>

        <h4><code>setInstructions(instructions: string): void</code></h4>
        <p>Update the agent&apos;s system instructions.</p>

        <h4><code>getState(): AgentState</code></h4>
        <p>Get current agent state and metrics.</p>
      </section>

      <section>
        <h2>SubAgent Class</h2>
        <p>Create and manage sub-agents for parallel processing.</p>
        <h3>Constructor</h3>
        <pre><code>{`new SubAgent(config: SubAgentConfig)`}</code></pre>

        <h3>Methods</h3>
        <h4><code>spawn(count: number): Promise&lt;SubAgentInstance[]&gt;</code></h4>
        <p>Create multiple sub-agent instances.</p>
        <h4><code>dispatch(task: Task): Promise&lt;Result&gt;</code></h4>
        <p>Dispatch a task to available sub-agents.</p>
        <h4><code>waitAll(): Promise&lt;void&gt;</code></h4>
        <p>Wait for all sub-agents to complete their tasks.</p>
      </section>

      <section>
        <h2>Orchestration API (Builderforce.ai)</h2>
        <p>REST API at <code>api.builderforce.ai</code> for orchestrating agents through the mesh.</p>
        <h3>Endpoints</h3>
        <h4><code>POST /api/agents</code></h4>
        <p>Create a new agent.</p>
        <h4><code>GET /api/agents/:id</code></h4>
        <p>Get agent details and status.</p>
        <h4><code>POST /api/agents/:id/tasks</code></h4>
        <p>Submit a task to an agent.</p>
        <h4><code>GET /api/tasks/:taskId</code></h4>
        <p>Get task status and results.</p>
        <h4><code>GET /api/mesh/status</code></h4>
        <p>Get mesh network status and connected agents.</p>
      </section>

      <section>
        <h2>Type Definitions</h2>
        <h3>AgentConfig</h3>
        <pre><code>{`interface AgentConfig {
  name: string;
  model: string;
  instructions: string;
  tools?: Tool[];
  memory?: MemoryConfig;
  timeout?: number;
}`}</code></pre>

        <h3>Task</h3>
        <pre><code>{`interface Task {
  task: string;
  input?: any;
  timeout?: number;
  priority?: 'low' | 'normal' | 'high';
}`}</code></pre>

        <h3>Result</h3>
        <pre><code>{`interface Result {
  success: boolean;
  output: any;
  error?: string;
  executionTime: number;
  tokens?: { input: number; output: number };
}`}</code></pre>
      </section>
    </>
  );
}
