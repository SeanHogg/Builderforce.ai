import type { Metadata } from 'next';
import Link from 'next/link';
import JsonLd from '@/components/JsonLd';
import { BRAND } from '@/lib/content';
import { pageMetadata } from '@/lib/seo';
import styles from './sell-builderforce.module.css';
import { signInHref } from '@/lib/auth';

export const runtime = 'edge';

const description = 'Join the Builderforce referral and sales associate program. Run outreach, manage leads, track goals and collaborate with Builderforce from one persistent sales canvas.';

export const metadata: Metadata = pageMetadata({
  title: 'Sell Builderforce — Referral & Sales Associate Program',
  description,
  path: '/sell-builderforce',
  ogTitle: 'Grow with Builderforce',
});

const capabilities = [
  { title: 'One sales canvas', text: 'Plan and execute sales and marketing work in one persistent, account-backed workspace that your team and Builderforce can collaborate in.' },
  { title: 'CRM & pipeline', text: 'Upload contacts, organize lists, qualify leads, track stages, and see where every opportunity sits in your pipeline.' },
  { title: 'Market targeting', text: 'Define the markets and audiences you want to reach, then build focused campaigns around them.' },
  { title: 'Email campaigns', text: 'Create outreach, organize follow-ups, and connect campaign activity to the contacts and opportunities it is meant to move.' },
  { title: 'Goals & coaching', text: 'Set weekly activity and revenue goals, see the actions needed to close the gap, and request one-to-one guidance from Builderforce.' },
  { title: 'Meetings & calendar', text: 'Connect your calendar, schedule prospect meetings, and invite the Builderforce superadmin when you want support on a call.' },
];

const materials = [
  { label: 'GUIDE', title: 'Sales discovery guide', text: 'Qualification questions, impact prompts, and a practical next-step framework.', href: '/media/sales/Builderforce-Sales-Discovery-Guide.html' },
  { label: 'PLAYBOOK', title: 'Outbound email playbook', text: 'A concise three-touch sequence with approved Builderforce positioning.', href: '/media/sales/Builderforce-Outbound-Playbook.html' },
  { label: 'CSV', title: 'CRM contact template', text: 'Import-ready fields for contacts, target markets, and pipeline stages.', href: '/media/sales/Builderforce-Contacts-Template.csv' },
];

export default function SellBuilderforcePage() {
  const programSchema = {
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: 'Builderforce Referral & Sales Associate Program',
    description,
    provider: { '@type': 'Organization', name: BRAND.name, url: BRAND.url },
    url: `${BRAND.url}/sell-builderforce`,
  };

  return (
    <main className={styles.page}>
      <JsonLd data={programSchema} />

      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>Referral &amp; sales associate program</p>
          <h1>Sell Builderforce.<br />Build a pipeline you own.</h1>
          <p className={styles.lede}>Get the materials, connected sales workspace, and direct support you need to introduce Builderforce to the right teams—and earn according to the referral and sales rates assigned to your program.</p>
          <div className={styles.actions}>
            <Link className={styles.primaryButton} href="/register?role=sales&next=/sales">Become a sales associate</Link>
            <Link className={styles.secondaryButton} href={signInHref('/sales')}>Associate sign in</Link>
          </div>
          <p className={styles.finePrint}>Program participation and commission eligibility are subject to approval and the terms shown in your account.</p>
        </div>
        <div className={styles.heroPanel} aria-label="Sales associate workspace overview">
          <span className={styles.status}><i /> Sales workspace</span>
          <h2>From revenue goal to next action</h2>
          <div className={styles.metricRow}>
            <div><small>Pipeline</small><strong>Contacts → Won</strong></div>
            <div><small>Goals</small><strong>Weekly cadence</strong></div>
          </div>
          <ul>
            <li><span>01</span>Target the right market</li>
            <li><span>02</span>Launch coordinated outreach</li>
            <li><span>03</span>Track signups and conversions</li>
            <li><span>04</span>Improve with Builderforce coaching</li>
          </ul>
        </div>
      </section>

      <section className={styles.section}>
        <p className={styles.eyebrow}>Your sales operating system</p>
        <h2>Everything centered on a single canvas</h2>
        <p className={styles.sectionIntro}>This is more than a referral link. Your associate account brings the essential CRM, campaign, scheduling, and coaching tools together so each action has context.</p>
        <div className={styles.capabilityGrid}>
          {capabilities.map((capability, index) => (
            <article key={capability.title} className={styles.capabilityCard}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <h3>{capability.title}</h3>
              <p>{capability.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.splitSection}>
        <div>
          <p className={styles.eyebrow}>A program with visibility</p>
          <h2>Know when your work turns into revenue</h2>
          <p>Receive notifications when attributed users sign up and when they convert. Your dashboard connects activity, opportunities, referrals, and earnings so you can focus on the next best action.</p>
        </div>
        <div className={styles.checkList}>
          <p><span>✓</span> Signup and conversion notifications</p>
          <p><span>✓</span> Pricing-linked referral and sales rates</p>
          <p><span>✓</span> Revenue goals translated into pipeline targets</p>
          <p><span>✓</span> Direct meeting requests and deal support</p>
        </div>
      </section>

      <section className={styles.section}>
        <p className={styles.eyebrow}>Sales toolkit</p>
        <h2>Start with approved materials</h2>
        <p className={styles.sectionIntro}>Use these resources for prospecting and discovery. The public press and product deck remains available in the <Link href="/media">Media Kit</Link>.</p>
        <div className={styles.materialGrid}>
          {materials.map((material) => (
            <a key={material.href} className={styles.materialCard} href={material.href} download>
              <span>{material.label}</span>
              <h3>{material.title}</h3>
              <p>{material.text}</p>
              <strong>Download →</strong>
            </a>
          ))}
        </div>
      </section>

      <section className={styles.stepsSection}>
        <p className={styles.eyebrow}>How it works</p>
        <div className={styles.steps}>
          <article><b>1</b><div><h3>Create your associate account</h3><p>Choose the Sales Associate account type and submit your program details.</p></div></article>
          <article><b>2</b><div><h3>Set your market and revenue goal</h3><p>Build a pipeline plan around the audience and outcome you want to pursue.</p></div></article>
          <article><b>3</b><div><h3>Run the work from your canvas</h3><p>Manage contacts, campaigns, meetings, follow-ups, and coaching in one place.</p></div></article>
        </div>
      </section>

      <section className={styles.cta}>
        <div><p className={styles.eyebrow}>Ready to start?</p><h2>Turn your network into a repeatable sales motion.</h2></div>
        <Link className={styles.primaryButton} href="/register?role=sales&next=/sales">Join the program</Link>
      </section>
    </main>
  );
}
