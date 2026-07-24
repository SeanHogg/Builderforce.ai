# Builderforce.ai — Pitch Deck (Investor & Partner Briefing)

Consultant-grade sales/investor deck. 18 slides, 16:9, 2560×1440.

## Files
- `Builderforce-Pitch-Deck.pdf` — full deck, print/email ready
- `Builderforce-Pitch-Deck.pptx` — PowerPoint (one full-bleed image per slide)
- `slides/slide-01.png … slide-18.png` — individual slides as PNG marketing media

## Slide order
1. Cover — "The innovation platform for the agentic era"
2. Problem — AI writes the code, nobody governs the work
3. Why Now — four converging forces
4. Market — TAM / SAM / SOM
5. Solution — the system of record
6. How It Works — compile a need → AgentSpec → deploy
7. Platform — six capability pillars
8. Moat — Evermind, the self-updating model
9. Agentic Workforce — humans + agents on one board
10. Governance & Trust
11. Competitive landscape (magic-quadrant)
12. Why we win (capability matrix vs the field)
13. Business model & pricing
14. Traction & product depth
15. Go-to-market
16. Roadmap & ARR milestones
17. Team
18. The Ask

## Placeholders to complete before sending to investors
The deck ships with verifiable product facts filled in. A few go-to-market /
financial fields are intentionally left as blanks for you to complete:
- **Slide 14 (Traction):** design partners, waitlist/signups, ARR run-rate, VS Code installs
- **Slide 18 (The Ask):** seed raise amount (`$__`)

## Regenerating
Source generator: `scratchpad/deck.py` (Pillow). Brand mark is the official
lockup (`1000008435.png`) trimmed to `lockup.png`. Re-run to rebuild all formats.

## Notes
- Market-size figures are labelled as illustrative industry estimates, not company financials.
- ARR figures on the roadmap slide are the company's own internal targets.
- Content is sourced from `frontend/src/lib/content.ts` and DONE.md / ROADMAP.md.
