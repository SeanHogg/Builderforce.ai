import JsonLd from '@/components/JsonLd';
import { homepageSchema } from '@/lib/structured-data';
import { DemoShowcase } from '@/components/demo/DemoShowcase';
import { AboutAppSection } from '@/components/home/AboutAppSection';
import { FounderGraphSection } from '@/components/home/FounderGraphSection';
import { LandingCanvasHero } from '@/components/home/LandingCanvasHero';
import { MeetCarousel } from '@/components/home/MeetCarousel';
import { TensionBeat } from '@/components/home/TensionBeat';
import { HomeFaqSection } from '@/components/home/HomeFaqSection';
import { HomePricingSection } from '@/components/home/HomePricingSection';
import { CreationCtaSection } from '@/components/marketing/CreationCtaSection';
import { LatestBlogSection } from '@/components/marketing/LatestBlogSection';
import { NewsletterSignupSection } from '@/components/marketing/NewsletterSignupSection';

/**
 * The homepage is one argument, told in order.
 *
 * It previously ran as an inventory: eight sections labelled 01…08 — proof,
 * compare, steps, features, pricing, blog, newsletter, FAQ — each rendered as
 * the same card grid, with a SECOND set of numbers (01/02/03) decorating the
 * cards inside them. Nothing in that ordering was a sequence, so the numbering
 * announced a structure the content did not have, and eight identical grids gave
 * the reader no sense of moving through anything.
 *
 * The order below is a narrative: start on the canvas → say plainly what the
 * application is → name the problem and resolve it into a workflow → see what
 * it is → say what holds it together → watch it work → price → objections →
 * act. Product discovery and
 * comparison now live on the dedicated product page, where visitors are asking
 * for that depth. Numbering survives in exactly one place, "How it works",
 * because those three steps genuinely are a sequence.
 *
 * Treatment varies with the job: pricing is a plan comparison, and objections
 * are a disclosure list. Secondary material sits below the primary call to
 * action rather than between the reader and it.
 *
 * A SERVER component. It was `'use client'` for exactly one reason — a
 * `useEffect` that fetched public pricing — and that one reason pulled the
 * structured data, the section shells, the About band and the FAQ copy into the
 * client bundle with it. The fetch now belongs to the band that needs it.
 */
export default function LandingPage() {
  return (
    <>
      <JsonLd data={homepageSchema()} />
      <main>
        {/* 1 · START — the board itself, with a composer. The product argues for
            itself before a word of description. */}
        <LandingCanvasHero />

        {/* 2 · WHAT THIS IS, IN WORDS — the hero DEMONSTRATES the product; this
            band states it. Someone who needs the application named and its
            purpose spelled out (including which connected-service permissions it
            asks for) should not have to infer either from a board. */}
        <AboutAppSection />

        {/* 3 · PROBLEM → WORKFLOW — the fragmented-tool tension and the
            three-step answer are one argument, not two disconnected sections. */}
        <TensionBeat />

        {/* 4 · WHAT IT IS — the rotating Create → Evermind → governed-delivery story. */}
        <MeetCarousel />

        {/* 5 · WHAT HOLDS IT TOGETHER — "what it is" (above) and "see it run"
            (below) both leave a founder's question open: what connects a board
            full of objects to a round they can close. One company record does,
            and this band names its four edges. */}
        <FounderGraphSection />

        {/* 6 · SEE IT RUN */}
        <DemoShowcase />

        {/* 7 · WHAT IT COSTS */}
        <HomePricingSection />

        {/* 8 · OBJECTIONS — answered immediately before the ask, which is where
            they actually surface. */}
        <HomeFaqSection />

        {/* 9 · THE ASK */}
        <CreationCtaSection />

        {/* Secondary. Below the ask on purpose — these used to sit between the
            reader and the call to action. They stay on the page for the crawler
            and for the visitor who wants depth before deciding. */}
        <LatestBlogSection />
        <NewsletterSignupSection />
      </main>
    </>
  );
}
