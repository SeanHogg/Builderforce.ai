import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Examples — CoderClaw Docs',
  description: 'Real-world examples to help you get started with CoderClaw. Each example is a complete, working project.',
  alternates: { canonical: '/coderclaw/docs/examples' },
};

const codeAnalyzer = `import { Agent } from 'coderclaw';

const codeAnalyzer = new Agent({
  name: 'CodeAnalyzer',
  model: 'claude-opus',
  instructions: \`You are an expert code reviewer. Analyze code for:
    1. Performance issues
    2. Security vulnerabilities
    3. Best practice violations
    4. Code style improvements
    Provide specific, actionable feedback.\`,
  tools: [
    { name: 'analyze_syntax',  description: 'Check code syntax and structure' },
    { name: 'check_security',  description: 'Scan for security vulnerabilities' }
  ]
});

const result = await codeAnalyzer.run({
  task: 'Review this code for issues',
  input: \`
    function getUserData(id) {
      const sql = "SELECT * FROM users WHERE id = " + id;
      const result = database.query(sql);
      return result;
    }
  \`
});

console.log(result.output);`;

const docGenerator = `import { Agent } from 'coderclaw';

const docGenerator = new Agent({
  name: 'DocGenerator',
  model: 'claude-opus',
  instructions: \`Generate clear, comprehensive documentation that includes:
    - Function descriptions
    - Parameter explanations
    - Return value documentation
    - Usage examples
    - Edge cases
  Format output as Markdown.\`
});

const result = await docGenerator.run({
  task: 'Generate documentation for this module',
  input: sourceCode
});

console.log(result.output);`;

const parallelTesting = `import { Agent, SubAgent } from 'coderclaw';

const parentAgent = new Agent({
  name: 'TestOrchestrator',
  model: 'claude-opus',
  instructions: 'Coordinate testing across multiple components'
});

const testSubAgent = new SubAgent({ name: 'TestRunner', model: 'claude-opus' });

const testAgents = await testSubAgent.spawn(4);

const components = [
  { name: 'auth',  path: './src/auth.ts' },
  { name: 'api',   path: './src/api.ts' },
  { name: 'db',    path: './src/db.ts' },
  { name: 'utils', path: './src/utils.ts' }
];

const testResults = await Promise.all(
  components.map((comp, i) =>
    testAgents[i].run({
      task: \`Test the \${comp.name} module\`,
      input: readFileSync(comp.path, 'utf8')
    })
  )
);

await testSubAgent.waitAll();
console.log('All tests completed', testResults);`;

const refactoring = `import { Agent } from 'coderclaw';

const refactoringAgent = new Agent({
  name: 'RefactoringExpert',
  model: 'claude-opus',
  instructions: \`You are a code refactoring specialist. When given code:
    1. Identify refactoring opportunities
    2. Apply modern patterns and practices
    3. Maintain 100% backward compatibility
    4. Improve readability and maintainability
    5. Provide detailed explanation of changes
  \`
});

const result = await refactoringAgent.run({
  task: 'Refactor this legacy code',
  input: legacyCode,
  timeout: 60000
});

console.log('Refactored code:', result.output);`;

const meshNetwork = `import { Agent } from 'coderclaw';

const codeReviewer        = new Agent({ name: 'CodeReviewer',        model: 'claude-opus' });
const testWriter          = new Agent({ name: 'TestWriter',          model: 'claude-opus' });
const documentationWriter = new Agent({ name: 'DocWriter',           model: 'claude-opus' });

const meshUrl = 'https://api.builderforce.ai/mesh';

await codeReviewer.register(meshUrl);
await testWriter.register(meshUrl);
await documentationWriter.register(meshUrl);

const result = await codeReviewer.run({
  task: 'Implement a new feature and coordinate reviews',
  mesh: meshUrl
});`;

export default function ExamplesPage() {
  return (
    <>
      <h1>Examples</h1>
      <p className="lead">Real-world examples to help you get started with CoderClaw. Each example is a complete, working project.</p>

      <section>
        <h2>1. Code Analyzer Agent</h2>
        <p>A simple agent that analyzes code quality, identifies bugs, and suggests improvements.</p>
        <pre><code>{codeAnalyzer}</code></pre>
        <p><strong>Key features:</strong> security analysis, performance optimization, code style guidance.</p>
      </section>

      <section>
        <h2>2. Documentation Generator</h2>
        <p>Automatically generate comprehensive documentation from code with examples and API reference.</p>
        <pre><code>{docGenerator}</code></pre>
        <p><strong>Key features:</strong> auto-documentation, example generation, type documentation.</p>
      </section>

      <section>
        <h2>3. Parallel Testing with Sub-Agents</h2>
        <p>Use sub-agents to run tests in parallel across different components.</p>
        <pre><code>{parallelTesting}</code></pre>
        <p><strong>Key features:</strong> parallel processing, task distribution, result aggregation.</p>
      </section>

      <section>
        <h2>4. Project Refactoring Agent</h2>
        <p>A sophisticated agent that refactors large codebases while maintaining functionality.</p>
        <pre><code>{refactoring}</code></pre>
        <p><strong>Key features:</strong> code transformation, pattern matching, compatibility preservation.</p>
      </section>

      <section>
        <h2>5. Multi-Agent Mesh Network</h2>
        <p>Set up a complete mesh network of specialized agents working together through Builderforce.ai.</p>
        <pre><code>{meshNetwork}</code></pre>
        <p><strong>Key features:</strong> agent mesh networking, service discovery, inter-agent communication.</p>
      </section>

      <section>
        <h2>Next Steps</h2>
        <ul>
          <li>Run the examples locally with the provided Docker setup</li>
          <li>Modify examples for your specific use case</li>
          <li>Check the <a href="/coderclaw/docs/api-reference">API Reference</a> for detailed documentation</li>
          <li>Share your examples in the <a href="/coderclaw/showcase">showcase</a></li>
        </ul>
      </section>
    </>
  );
}
