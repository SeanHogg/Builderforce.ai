# BuilderForce.ai — Sales & Product Deck

Consultant-grade sales / informational deck for customers and investors. 20 slides, 16:9, 2560×1440. **Light / print-optimized** theme — tinted paper, white focal cards with shadows, saturated blue icon tiles and takeaway bands as the retention anchors. Official BuilderForce.ai mark + wordmark.

## Files
- `Builderforce-Pitch-Deck.pdf` — full deck, print/email ready
- `Builderforce-Pitch-Deck.pptx` — PowerPoint (one full-bleed image per slide)
- `slides/slide-01.png … slide-19.png` — individual slides as PNG marketing media

## Slide order
1. Cover — "The innovation platform for the agentic era"
2. Problem — AI writes the code, nobody governs the work
3. Why Now — four converging forces
4. Market — TAM / SAM / SOM
5. Solution — the system of record
6. How It Works — compile a need → AgentSpec → deploy
7. Full capability map — Build & Train · Orchestrate · Extend · Govern & Operate
8. Agentic delivery in the cloud — ticket → PR, human in the loop
9. Moat — Evermind, the self-updating model
10. Works with your stack — BYO keys, 30+ providers, Claude subscription OAuth
11. Agentic Workforce — humans + agents on one board
12. Governance & human-in-the-loop
13. Competitive landscape (magic-quadrant)
14. Why we win (capability matrix vs the field)
15. Business model & pricing
16. Traction & product depth
17. Go-to-market
18. Roadmap & milestones
19. Team — Sean Hogg, founder track record
20. Get started (CTA)

## Notes
- Market-size figures are labelled as illustrative industry estimates, not company financials.
- ARR figures on the roadmap slide are the company's own internal targets.
- Content is sourced from `frontend/src/lib/content.ts`, `DONE.md`, `ROADMAP.md`, and the founder résumé.
- Colors are driven by the brand blue (`#4d9eff` → `#1e40af`), matching the site `--accent` and the logo gradient.

## Regenerating
Source generator: `scratchpad/deck.py` (Pillow). Brand mark is the official
lockup (`1000008435.png`) trimmed to `lockup.png`. Re-run to rebuild all three formats.
