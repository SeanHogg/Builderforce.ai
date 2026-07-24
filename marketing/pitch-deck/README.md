# BuilderForce.ai — Sales & Product Deck

Consultant-grade, **visual-first** sales deck. 26 slides, 16:9, 2560×1440. Light print theme: tinted paper, white focal cards, saturated blue tiles, solid-blue takeaway bands, deep-navy contrasting footer, Evermind brain-dot + arc background motif on every slide. Product illustrations are pulled from the marketing blog art (`frontend/public/blog/*.svg`, rasterized via Edge headless).

## Files
- `Builderforce-Pitch-Deck.pdf` — full deck, print/email ready
- `Builderforce-Pitch-Deck.pptx` — PowerPoint (one full-bleed image per slide)
- `slides/slide-01…23.png` — individual slides as PNG marketing media

## Slide order
1. Cover — Evermind brain + neuroscience legend
2. Problem — icon-led, one line per pain
3. Why Now — four forces
4. Market — TAM / SAM / SOM
5. Solution — *Transformation, delivered on one platform* (`system-of-record` art)
6. How It Works — compile spine (`compile-primitive-spine` art)
7. Platform — four capability pillars
8. Autonomous Workflows — *A Kanban board that drives itself* (`autonomous-swimlanes` art)
9. Autonomous Planning — portfolio→task costed spine (`planning-spine` art)
10. Evermind moat — frozen vs Evermind (`aw-frozen-vs-evermind` art)
11. Works With Your Stack — BYO keys / frontier models (`fleet-routing` art)
12. Agentic Workforce (`aw-workforce` art)
13. Real-Time Collaboration (`collab-four-surfaces` art)
14. Ratings & Scales — maturity result + five-level ladder
15. Governance & Human-in-the-Loop (`approval-gates` art)
16. Security Architecture (`security-multitenant` art)
17. Competitive quadrant
18. Capability matrix
19. Business model & pricing (+ volume-pricing footnote)
20. Unit economics — illustrative ROI of one autonomous lane
21. Adoption path — Day 1 / Week 1 / Month 1 (`getting-started` art)
22. Traction & product depth
23. Go-to-market
24. Roadmap & milestones
25. Team — Sean Hogg (+ continuity-by-design note)
26. Get started (CTA) — Evermind-brain bookend of the cover

## Regenerating
`scratchpad/deck.py` (Pillow). Blog SVGs are rasterized once into `scratchpad/blogimg/` with Edge headless:
`msedge --headless --screenshot=<out.png> --window-size=1600,900 file:///<blog>.svg`
Brand mark: `mark.png` (keyed from `c:\code\agentic\1000008436.png`).

## Notes
- Market figures are labelled illustrative estimates; roadmap ARR figures are internal targets.
- Content sources: `frontend/src/lib/content.ts`, DONE.md/ROADMAP.md, founder résumé, blog illustration library.
