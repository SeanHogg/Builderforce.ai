import { describe, expect, it } from 'vitest';
import { canvasApp, canvasAppFiles } from '@/lib/canvasApp';

describe('repro: GreenEdge session (full real payload)', () => {
  it('full 3-page website payload from the actual diagnostics dump', () => {
    const websiteNode = {
      id: '4626e788-41e4-4590-af17-403481737b19',
      data: {
        kind: 'website',
        title: 'GreenEdge Yard Care — Marketing Site',
        pages: [
          {
            id: 'home',
            name: 'Home',
            path: '/',
            sections: [
              { id: 'hero', kind: 'hero', eyebrow: 'Residential yard care, done right', heading: 'Your yard, beautifully maintained — every week, without the hassle.', body: 'GreenEdge Yard Care delivers reliable, professional lawn maintenance for busy homeowners. Text confirmations, online quotes, and a real person who shows up on time.', cta: 'Request a Free Quote', secondaryCta: 'See Our Services' },
              { id: 'features', kind: 'features', heading: 'Why homeowners switch to GreenEdge', items: [
                { title: 'Reliable weekly cadence', body: 'Same day, same crew, every week.' },
                { title: 'Transparent pricing', body: 'Three simple tiers.' },
                { title: 'Insured & professional', body: 'Fully licensed and $1M liability insured.' },
              ] },
              { id: 'stats', kind: 'stats', heading: 'Built for busy homeowners', items: [
                { value: '15 mi', label: 'Service radius' },
                { value: '24h', label: 'Quote turnaround' },
                { value: '100%', label: 'Satisfaction on first visit' },
              ] },
              { id: 'testimonial', kind: 'testimonial', quote: 'Finally a lawn service that just shows up.', author: 'Early customer, Maple Ridge neighborhood' },
              { id: 'cta', kind: 'cta', heading: 'Ready for a yard you do not have to think about?', body: 'Get a free quote in under 2 minutes.', cta: 'Request a Quote' },
            ],
          },
          {
            id: 'services',
            name: 'Services & Pricing',
            path: '/services',
            sections: [
              { id: 'hero', kind: 'hero', eyebrow: 'Services & pricing', heading: 'Three tiers. No surprises.', body: 'Pick the level of care that fits your yard.' },
              { id: 'features', kind: 'features', heading: 'Service tiers', items: [
                { title: 'Edge — $45/visit', body: 'Mowing, edging, and blowing.' },
              ] },
              { id: 'content', kind: 'content', heading: 'One-time services', body: 'First-time cleanups from $150.' },
              { id: 'cta', kind: 'cta', heading: 'Not sure which tier?', body: 'Tell us about your yard.', cta: 'Get a Recommendation' },
            ],
          },
          {
            id: 'quote',
            name: 'Request a Quote',
            path: '/quote',
            sections: [
              { id: 'hero', kind: 'hero', eyebrow: 'Free quote, no obligation', heading: 'Request a quote', body: 'Fill this out and we will text you back within 24 hours.' },
              { id: 'content', kind: 'content', heading: 'Tell us about your yard', body: 'Name, address, phone, yard size, and what you need.' },
              { id: 'cta', kind: 'cta', heading: 'Prefer to chat?', body: 'Our AI assistant can answer service questions.', cta: 'Open Chat' },
            ],
          },
        ],
        websiteTheme: { style: 'bold', background: '#0F3D2E', foreground: '#F5F1E8', accent: '#7BC47F' },
      },
    };
    const files = canvasAppFiles([websiteNode as never]);
    console.log('WEBSITE FILES (full):', JSON.stringify(files.map((f) => ({ path: f.path, role: f.role, len: f.source.length })), null, 2));
    const app = canvasApp([websiteNode as never]);
    console.log('APP (full):', { filesLen: app.files.length, hasEntry: !!app.entry, hasDoc: !!app.document, docNull: app.document === null });
  });
});
