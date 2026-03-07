import Link from 'next/link';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-bg-deep text-text-primary">
      {/* Navigation */}
      <nav className="border-b border-gray-800 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="/coderclaw.png" alt="CoderClaw" className="h-6 w-auto" />
            <span className="text-coral-bright text-2xl">⚡</span>
            <span className="text-xl font-bold">Builderforce.ai</span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/workforce" className="text-text-secondary hover:text-text-primary text-sm transition-colors">
              Workforce
            </Link>
            <Link href="/login" className="text-text-secondary hover:text-text-primary text-sm transition-colors">
              Sign In
            </Link>
            <Link
              href="/register"
              className="bg-coral-bright hover:bg-coral-mid text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              Get Started Free
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 py-24 text-center">
        <div className="inline-flex items-center gap-2 bg-coral-bright/10 border border-coral-bright/20 rounded-full px-4 py-1.5 text-coral-bright text-sm mb-8">
          <span className="w-2 h-2 bg-coral-bright rounded-full animate-pulse" />
          Powered by CoderClaw Technology
        </div>
        <h1 className="text-5xl md:text-6xl font-bold mb-6 leading-tight">
          Build Your LLM.{' '}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-coral-bright to-coral-dark">
            Train Your Agent.
          </span>
          {' '}Join the Workforce.
        </h1>
        <p className="text-gray-400 text-xl max-w-3xl mx-auto mb-10">
          The decentralized AI workforce platform. Fine-tune your own custom LLM in the browser,
          embed it as a human-in-the-loop agent via CoderClaw technology, and register yourself
          into the agentic workforce powering real products.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link
            href="/register"
            className="w-full sm:w-auto bg-coral-bright hover:bg-coral-mid text-white px-8 py-3 rounded-xl text-base font-semibold transition-colors"
          >
            Join the Workforce — Free
          </Link>
          <Link
            href="/login"
            className="w-full sm:w-auto border border-gray-700 hover:border-gray-500 text-gray-300 hover:text-white px-8 py-3 rounded-xl text-base font-semibold transition-colors"
          >
            Sign In
          </Link>
        </div>
      </section>

      {/* Value Proposition Pillars */}
      <section className="max-w-6xl mx-auto px-6 py-16">
        <h2 className="text-3xl font-bold text-center mb-4">
          The complete Build → Train → Register → Deploy loop
        </h2>
        <p className="text-gray-400 text-center max-w-2xl mx-auto mb-12">
          Every step from raw data to a production agent — entirely in the browser.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {PILLARS.map((p) => (
            <div
              key={p.title}
              className="bg-surface border border-gray-800 rounded-xl p-6 hover:border-coral-dark/50 transition-colors text-center"
            >
              <div className="text-4xl mb-4">{p.icon}</div>
              <h3 className="text-lg font-semibold mb-2 text-coral-mid">{p.title}</h3>
              <p className="text-gray-400 text-sm leading-relaxed">{p.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Human-in-the-Loop Feature Highlight */}
      <section className="max-w-6xl mx-auto px-6 py-16">
        <div className="bg-gradient-to-r from-purple-900/30 to-blue-900/30 border border-purple-700/30 rounded-2xl p-10 md:p-14">
          <div className="max-w-3xl mx-auto text-center">
            <div className="text-5xl mb-6">🧠</div>
            <h2 className="text-3xl font-bold mb-4">You are the intelligence inside the agent</h2>
            <p className="text-gray-300 text-lg mb-6 leading-relaxed">
              Builderforce introduces <strong className="text-purple-300">human-in-the-loop LLM training</strong>.
              Train a custom model on your own expertise, decisions, and domain knowledge — then embed
              it directly into an autonomous agent using{' '}
              <strong className="text-blue-300">CoderClaw technology</strong>. Your reasoning,
              your patterns, your intelligence — running at machine speed.
            </p>
            <p className="text-gray-400 text-base leading-relaxed">
              Register your trained agent into the <strong className="text-white">Builderforce Workforce Registry</strong> and
              let it work for you autonomously across any integrated platform — starting with{' '}
              <a
                href="https://github.com/SeanHogg/coderClaw"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:text-blue-300 underline"
              >
                CoderClaw
              </a>
              .
            </p>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-6xl mx-auto px-6 py-16">
        <h2 className="text-3xl font-bold text-center mb-12">
          Everything you need to build your AI identity
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="bg-gray-900 border border-gray-800 rounded-xl p-6 hover:border-gray-700 transition-colors"
            >
              <div className="text-3xl mb-4">{f.icon}</div>
              <h3 className="text-lg font-semibold mb-2">{f.title}</h3>
              <p className="text-gray-400 text-sm leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Who is this for */}
      <section className="max-w-6xl mx-auto px-6 py-16">
        <h2 className="text-3xl font-bold text-center mb-12">Who is Builderforce for?</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {MARKETS.map((m) => (
            <div
              key={m.title}
              className="bg-gray-900 border border-gray-800 rounded-xl p-6 hover:border-gray-700 transition-colors"
            >
              <div className="text-3xl mb-4">{m.icon}</div>
              <h3 className="text-lg font-semibold mb-2">{m.title}</h3>
              <p className="text-gray-400 text-sm leading-relaxed">{m.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-6xl mx-auto px-6 py-16">
        <h2 className="text-3xl font-bold text-center mb-12">How it works</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {STEPS.map((s, i) => (
            <div key={s.title} className="text-center">
              <div className="w-12 h-12 rounded-full bg-blue-600/20 border border-blue-600/40 text-blue-400 text-lg font-bold flex items-center justify-center mx-auto mb-4">
                {i + 1}
              </div>
              <h3 className="font-semibold mb-2">{s.title}</h3>
              <p className="text-gray-400 text-sm">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-6xl mx-auto px-6 py-24 text-center">
        <div className="bg-gradient-to-r from-blue-900/40 to-purple-900/40 border border-blue-700/30 rounded-2xl p-12">
          <h2 className="text-3xl font-bold mb-4">Ready to register into the agentic workforce?</h2>
          <p className="text-gray-400 mb-8 max-w-xl mx-auto">
            Build your custom LLM, train it on your own expertise, embed it as a CoderClaw agent,
            and join the decentralized workforce powering the next generation of AI products.
          </p>
          <Link
            href="/register"
            className="inline-block bg-blue-600 hover:bg-blue-700 text-white px-10 py-3 rounded-xl text-base font-semibold transition-colors"
          >
            Join the Workforce — It&apos;s Free
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-800 px-6 py-8">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-gray-500">
            <span className="text-blue-400">⚡</span>
            <span className="text-sm">© 2025 Builderforce.ai</span>
          </div>
          <div className="flex gap-6 text-sm text-gray-500">
            <Link href="/login" className="hover:text-gray-300 transition-colors">Sign In</Link>
            <Link href="/register" className="hover:text-gray-300 transition-colors">Register</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

const PILLARS = [
  {
    icon: '🧠',
    title: 'Build',
    desc: 'Fine-tune a custom LLM in the browser using WebGPU LoRA training on your own datasets and expertise.',
  },
  {
    icon: '🤖',
    title: 'Train',
    desc: 'Create a human-in-the-loop model that captures your reasoning, decisions, and domain knowledge.',
  },
  {
    icon: '🌐',
    title: 'Register',
    desc: 'Publish your agent to the Builderforce Workforce Registry — discoverable and integrable from any platform.',
  },
  {
    icon: '🦀',
    title: 'Deploy',
    desc: 'Your agent powers real products via CoderClaw technology, starting with autonomous code review and automation.',
  },
];

const FEATURES = [
  {
    icon: '🧬',
    title: 'Custom LLM Training',
    desc: 'Fine-tune your own model in the browser. No local GPU, no cloud account — WebGPU LoRA training runs entirely client-side.',
  },
  {
    icon: '🪢',
    title: 'Human-in-the-Loop Agents',
    desc: 'Embed your trained model as a human-in-the-loop agent. Your expertise, encoded once, working autonomously forever.',
  },
  {
    icon: '🦀',
    title: 'CoderClaw Embedding',
    desc: 'Registered agents are embedded directly into CoderClaw — giving your custom AI brain real-world impact on production codebases.',
  },
  {
    icon: '🤖',
    title: 'AI-Assisted IDE',
    desc: 'Browser-based coding environment with AI assistance, real-time suggestions, and a full terminal powered by WebContainers.',
  },
  {
    icon: '👥',
    title: 'Real-Time Collaboration',
    desc: 'Work together live with Yjs-powered co-editing, shared cursors, and synchronized terminal sessions.',
  },
  {
    icon: '🔐',
    title: 'Enterprise Auth (RBAC)',
    desc: 'Role-based access control via api.coderclaw.ai. Multi-tenant workspaces with granular team permissions.',
  },
];

const MARKETS = [
  {
    icon: '👩‍💻',
    title: 'AI Developers',
    desc: 'Build, fine-tune, and ship specialized AI agents without managing infrastructure. Own your model weights from day one.',
  },
  {
    icon: '🏗️',
    title: 'Domain Experts',
    desc: 'Encode your expertise into a custom LLM. Let your agent represent you in automated workflows, code review, and decision-making.',
  },
  {
    icon: '🏢',
    title: 'Product Teams',
    desc: 'Integrate battle-tested domain-specific agents from the Workforce Registry directly into your product — no ML team required.',
  },
];

const STEPS = [
  { title: 'Create your account', desc: 'Sign up free. No credit card required.' },
  { title: 'Build your dataset', desc: 'Curate instruction-tuning data from your codebase, docs, or domain expertise.' },
  { title: 'Train your LLM', desc: 'Fine-tune a custom model in the browser using WebGPU LoRA. Your weights, stored in your own R2 bucket.' },
  { title: 'Register & deploy', desc: 'Publish your agent to the Workforce Registry and embed it into CoderClaw or any integrated platform.' },
];
