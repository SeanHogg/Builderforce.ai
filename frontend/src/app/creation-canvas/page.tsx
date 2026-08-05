import type { Metadata } from 'next';
import Link from 'next/link';
import { pageMetadata } from '@/lib/seo';
import RelatedArticles from '@/components/blog/RelatedArticles';

export const runtime = 'edge';

export const metadata: Metadata = pageMetadata({
  title: 'Creation Canvas — Turn Any Idea Into Something Real',
  description: 'One visual workspace where your team and AI agents design, build, review, and deliver websites, workflows, models, data stories, and products.',
  path: '/creation-canvas',
});

const capabilities = [
  ['Begin with an idea', 'Describe what you want to create and enter a private canvas immediately. Add an account, team, or project only when the work needs them.'],
  ['Create with real, connected objects', 'Websites, workflows, datasets, charts, prototypes, models, documents, people, and agents stay editable and connected instead of becoming flattened chat attachments.'],
  ['Give AI the whole picture', 'Ask Brain to work across the entire canvas, a selection, or a frame. Relationships preserve the context, evidence, and intent behind every artifact.'],
  ['Bring people and agents together', 'Invite collaborators, leave comments, follow live work, and place specialist AI agents beside the objects they help create.'],
  ['Stay in control', 'Review proposed changes before they are applied. Use checkpoints and branches to explore ideas without losing the version your team trusts.'],
  ['Move from concept to outcome', 'Turn approved work into projects and tasks, assign it to humans or AI agents, and follow delivery from the same creative context.'],
];

const specs = [
  ['Session model', 'Local guest draft → account-claimed, tenant-scoped durable session'],
  ['Spatial engine', 'Infinite pan/zoom canvas, minimap, marquee, drag/drop, resizing, typed connections, freehand drawing, and reusable frames'],
  ['Creation packs', 'Campaign, product discovery, data story, stand-up, Evermind model lab, and executive review Marketplace templates'],
  ['Collaboration', 'Role-based invitations, presence, cursors, selections, comments, mentions, activity, presentation, follow, checkpoints, branches, and reviewed merges'],
  ['AI contract', 'Canvas/selection/frame scope, canonical resource context, inspectable evidence, previewable command sets, and idempotent revisioned saves'],
  ['Safety and plans', 'Underlying-resource permission intersection, redacted tombstones, access requests, edit leases, watch controls, and plan-aware Session, collaborator, history, data, template, and realtime limits'],
  ['Surfaces', 'Cloudflare Edge web route and a native VS Code full-editor Creation Session surface backed by the same APIs'],
  ['Projects', 'Optional context and delivery destinations; add one or many, expand related items, compare evidence, and create roadmaps'],
  ['Model creation', 'Evermind creation, teaching, tuning, evaluation, versioning, packaging, and publishing on the canvas'],
];

export default function CreationCanvasMarketingPage() {
  return <main className="ccm">
    <style>{`
      .ccm{max-width:1160px;margin:auto;padding:72px 24px 96px;color:var(--text-primary);font-family:var(--font-sans)}
      .ccm-hero{text-align:center;max-width:900px;margin:0 auto 64px}.ccm-kicker{color:var(--coral-bright);font-weight:750;letter-spacing:.12em;text-transform:uppercase;font-size:.76rem}.ccm h1{font:750 clamp(2.5rem,7vw,5.3rem)/.98 var(--font-sans);letter-spacing:-.055em;margin:18px 0}.ccm-hero p{max-width:760px;margin:0 auto 28px;color:var(--text-secondary);font-size:1.16rem;line-height:1.65}.ccm-actions{display:flex;justify-content:center;gap:12px;flex-wrap:wrap}.ccm-actions a{padding:13px 22px;border:1px solid var(--border-subtle);border-radius:12px;text-decoration:none;font-weight:700;color:var(--text-primary)}.ccm-actions a:first-child{background:var(--coral-bright);border-color:var(--coral-bright);color:#fff}
      .ccm-board{position:relative;min-height:430px;margin:0 0 72px;border:1px solid var(--border-subtle);border-radius:24px;background-color:var(--surface-card);background-image:radial-gradient(var(--border-subtle) 1px,transparent 1px);background-size:24px 24px;overflow:hidden}.ccm-card{position:absolute;width:250px;padding:18px;border:1px solid var(--border-subtle);border-radius:14px;background:var(--surface-card);box-shadow:0 14px 38px rgba(27,53,86,.13)}.ccm-card b{display:block;margin-bottom:8px}.ccm-card span{color:var(--text-secondary);font-size:.86rem;line-height:1.5}.ccm-card:nth-child(1){left:6%;top:13%}.ccm-card:nth-child(2){left:39%;top:8%;width:300px}.ccm-card:nth-child(3){right:5%;top:18%}.ccm-card:nth-child(4){left:23%;bottom:10%}.ccm-card:nth-child(5){right:20%;bottom:8%}
      .ccm h2{font:750 clamp(1.7rem,4vw,2.6rem)/1.1 var(--font-sans);letter-spacing:-.035em;margin:64px 0 24px}.ccm-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.ccm-feature{padding:22px;border:1px solid var(--border-subtle);border-radius:16px;background:var(--surface-card)}.ccm-feature h3{margin:0 0 8px;font-size:1rem}.ccm-feature p{margin:0;color:var(--text-secondary);font-size:.9rem;line-height:1.6}.ccm-specs{border:1px solid var(--border-subtle);border-radius:16px;overflow:hidden}.ccm-spec{display:grid;grid-template-columns:190px 1fr;gap:20px;padding:16px 20px;border-bottom:1px solid var(--border-subtle)}.ccm-spec:last-child{border:0}.ccm-spec b{font-size:.9rem}.ccm-spec span{color:var(--text-secondary);line-height:1.55;font-size:.9rem}
      @media(max-width:800px){.ccm-grid{grid-template-columns:1fr}.ccm-board{min-height:650px}.ccm-card{position:relative!important;inset:auto!important;width:auto!important;margin:16px}.ccm-spec{grid-template-columns:1fr;gap:5px}}
    `}</style>
    <section className="ccm-hero"><div className="ccm-kicker">Builderforce Creation Canvas</div><h1>Turn any idea into something real.</h1><p>One creative canvas where your team and AI agents design, build, review, and deliver websites, workflows, models, data stories, and products—without the tool sprawl.</p><div className="ccm-actions"><Link href="/create/new">Start creating free →</Link><Link href="/product">See what you can create</Link></div></section>
    <section className="ccm-board" aria-label="Example Creation Canvas"><div className="ccm-card"><b>⌘ Campaign workflow</b><span>Audience → Create → Approve → Publish</span></div><div className="ccm-card"><b>◎ Interactive landing page</b><span>Live WYSIWYG website prototype</span></div><div className="ccm-card"><b>▥ Campaign forecast</b><span>Dataset-bound funnel and channel metrics</span></div><div className="ccm-card"><b>● Brain conversation</b><span>Will this workflow be effective with this page?</span></div><div className="ccm-card"><b>✦ Campaign strategist</b><span>Live agent · configured and assignable</span></div></section>
    <h2>From blank canvas to finished outcome</h2><section className="ccm-grid">{capabilities.map(([title, body]) => <article className="ccm-feature" key={title}><h3>{title}</h3><p>{body}</p></article>)}</section>
    <h2>Product specifications</h2><section className="ccm-specs">{specs.map(([label, value]) => <div className="ccm-spec" key={label}><b>{label}</b><span>{value}</span></div>)}</section>
    <RelatedArticles surface="creation-canvas" heading="Creation Canvas guides and use cases" />
    <section className="ccm-hero" style={{ marginTop: 80, marginBottom: 0 }}><h2>What will you create?</h2><p>Start with a prompt. Keep every idea, artifact, decision, collaborator, and agent connected until the work is ready to deliver.</p><div className="ccm-actions"><Link href="/create/new">Open a blank canvas →</Link></div></section>
  </main>;
}
