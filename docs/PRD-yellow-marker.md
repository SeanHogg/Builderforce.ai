# Yellow Risk Score Indicator

- Yellow tier: 50–74 (at risk). Detects entry/exit from Yellow.
- Color: #F5A623 (amber-yellow).
- i18n key names:
  - `projectCard.tier.yellow`: "At Risk" or an alternate label for context.
  - We can add a separate `projectCard.tier.yellow` entry now; for now we use the tier name and the label in the badge.

Reference:
- Box: `frontendsrclibprojectHealth.ts`
- Badge visual: `frontendsrccomponentsProjectHealth.tsx`

Banner summary:
- Yellow inclusive: 50–74
- Previous Watch: ≥60 (kept for compatibility)
- Previous At-risk: 40–49 (kept for compatibility)
- TIER_COLOR: includes yellow: '#F5A623' (border accent and badge background tint as required).

Type additions in `ProjectHealth`:
- `previousTier: HealthTier | null`
- `previousScore: number | null`

Helper `isYellowTransition(oldScore, newScore)`:
- Returns true if the score transitions across the Yellow boundary.

Acceptance:
- Testing against color compliance (#F5A623 vs var(--bg-base)) and contrast will be done in the tests.