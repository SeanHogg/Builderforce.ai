import type { Metadata } from 'next';
import ProsePage from '../ProsePage';

export const metadata: Metadata = {
  title: 'Contact — Builderforce.ai',
  description: 'Get in touch with Sean Hogg, creator and maintainer of BuilderForce Agents and Builderforce.ai.',
  alternates: { canonical: '/agents/contact' },
};

const links = [
  { label: 'github.com/SeanHogg', href: 'https://github.com/SeanHogg' },
  { label: 'Resume / Portfolio', href: 'https://myvideoresu.me/resumes/seanhogg' },
  { label: 'GitHub Discussions', href: 'https://github.com/seanhogg/agents/discussions' },
  { label: '@CrawfishMellow', href: 'https://instagram.com/CrawfishMellow' },
];

export default function ContactPage() {
  return (
    <ProsePage>
      <h1>Contact</h1>
      <p className="lead">
        Got questions about BuilderForce Agents, enterprise deployments, or just want to say hi? Reach out directly.
      </p>

      <section>
        <h2>Sean Hogg</h2>
        <p>Creator &amp; maintainer, BuilderForce Agents and Builderforce.ai.</p>
        <ul>
          {links.map((l) => (
            <li key={l.href}>
              <a href={l.href} target="_blank" rel="noopener">{l.label}</a>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Other ways to engage</h2>
        <ul>
          <li>
            <a href="https://github.com/seanhogg/agents" target="_blank" rel="noopener">BuilderForce Agents on GitHub</a>
            {' '}— file issues, open PRs, follow releases
          </li>
          <li>
            <a href="https://discord.gg/9gUsc2sNG6" target="_blank" rel="noopener">Discord community</a>
            {' '}— real-time help and discussion
          </li>
          <li>
            <a href="/agents/acknowledgements">Acknowledgements</a>
            {' '}— credits to the open-source projects this builds on
          </li>
        </ul>
      </section>
    </ProsePage>
  );
}
