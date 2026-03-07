import Link from 'next/link';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Navigation */}
      <nav className="border-b border-gray-800 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-blue-400 text-2xl">⚡</span>
            <span className="text-xl font-bold">Builderforce.ai</span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/workforce" className="text-gray-400 hover:text-white text-sm transition-colors">
              Workforce
            </Link>
            <Link href="/login" className="text-gray-400 hover:text-white text-sm transition-colors">
              Sign In
            </Link>
            <Link
              href="/register"
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              Get Started Free
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 py-24 text-center">
        <div className="inline-flex items-center gap-2 bg-blue-500/10 border border-blue-500/20 rounded-full px-4 py-1.5 text-blue-400 text-sm mb-8">
          <span className="w-2 h-2 bg-blue-400 rounded-full animate-pulse" />
          Powered by api.coderclaw.ai
        </div>
        <h1 className="text-5xl md:text-6xl font-bold mb-6 leading-tight">
          Build with AI,{' '}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400">
            Ship Faster
          </span>
        </h1>
        <p className="text-gray-400 text-xl max-w-3xl mx-auto mb-10">
          A cloud-native coding platform with AI assistance, real-time collaboration, and instant
          preview. Multi-tenant, enterprise-ready, and built for teams.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link
            href="/register"
            className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-xl text-base font-semibold transition-colors"
          >
            Start Building — Free
          </Link>
          <Link
            href="/login"
            className="w-full sm:w-auto border border-gray-700 hover:border-gray-500 text-gray-300 hover:text-white px-8 py-3 rounded-xl text-base font-semibold transition-colors"
          >
            Sign In
          </Link>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-6xl mx-auto px-6 py-16">
        <h2 className="text-3xl font-bold text-center mb-12">
          Everything you need to ship faster
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
          <h2 className="text-3xl font-bold mb-4">Ready to build something amazing?</h2>
          <p className="text-gray-400 mb-8 max-w-xl mx-auto">
            Join thousands of developers shipping faster with AI-assisted coding, real-time
            collaboration, and instant cloud previews.
          </p>
          <Link
            href="/register"
            className="inline-block bg-blue-600 hover:bg-blue-700 text-white px-10 py-3 rounded-xl text-base font-semibold transition-colors"
          >
            Get Started — It&apos;s Free
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-800 px-6 py-8">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-gray-500">
            <span className="text-blue-400">⚡</span>
            <span className="text-sm">© 2024 Builderforce.ai</span>
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

const FEATURES = [
  {
    icon: '🤖',
    title: 'AI-Assisted Coding',
    desc: 'Get real-time suggestions, auto-completions, and AI-generated code snippets powered by state-of-the-art models.',
  },
  {
    icon: '👥',
    title: 'Real-Time Collaboration',
    desc: 'Work together with your team live. See cursors, edits, and changes in real time across every file.',
  },
  {
    icon: '⚡',
    title: 'Instant Preview',
    desc: 'See your changes live in the browser the moment you save. No build step, no waiting.',
  },
  {
    icon: '🏢',
    title: 'Multi-Tenant',
    desc: 'Manage multiple organizations and workspaces from a single account. Isolate projects by tenant.',
  },
  {
    icon: '🔐',
    title: 'Enterprise Auth (RBAC)',
    desc: 'Role-based access control via api.coderclaw.ai. Assign roles to team members and control access granularly.',
  },
  {
    icon: '🚀',
    title: 'Cloud-Native',
    desc: 'Built on Cloudflare Workers for edge performance. Deploy anywhere in milliseconds.',
  },
];

const STEPS = [
  { title: 'Create an account', desc: 'Sign up free with your email.' },
  { title: 'Select your workspace', desc: 'Choose or create a tenant organization.' },
  { title: 'Start a project', desc: 'Pick a template and open the IDE in seconds.' },
  { title: 'Ship it', desc: 'Collaborate, iterate, and deploy instantly.' },
];
