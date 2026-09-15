-- 1174 · Release notes: list your startup and meet investors; runway and cashflow.
--
-- PRD 19 B1/B2 — BurnRateOS's business directory, founder onboarding and runway
-- tracker, merged onto the CEO's companies and the CFO's finance facts. Both are
-- `new`: nothing on the platform let a founder be found by investors before, and
-- the CFO seat had a burn TILE but no destination that showed the months, the
-- cash-out date or the month-by-month flow.
--
-- Marketing copy, framed on what a person can now DO (see the header of 1105).
-- Fixed ids so the migration is safe to replay; `emailed_at` left NULL so the
-- product-updates digest announces each exactly once. `version` is the frontend
-- release the surfaces ship in.
INSERT INTO release_notes (id, version, title, body, category, stage, published_at) VALUES
  (
    'a1b2c301-0009-4000-8000-000000001174',
    '2026.9.32',
    'List your startup and meet investors',
    'Your company now has a public face in the Marketplace. Open Investors → Listing, tell us about the business, declare your numbers, say what you are looking for, and list it. Investors browsing Marketplace → Companies see your stage, sector, traction and whether you are raising, and press Express interest to reach you. Every inquiry lands in Investors → Interest beside your other inbound, where you triage it; the CRO''s deal-flow report counts it. What a stranger sees is yours to decide — cash and burn never leave the workspace, and the investor contact is shown only to signed-in readers. A founder can start from the marketplace door and finish with a listed company in one sitting.',
    'new',
    'live',
    '2026-09-15 12:00:00'
  ),
  (
    'a1b2c302-0009-4000-8000-000000001174',
    '2026.9.32',
    'Runway and cashflow, with their provenance named',
    'Finance now opens on your runway: months of cash left, the net burn that produced it, and the date cash reaches zero. Two columns, never blended — what the platform has OBSERVED from approved expenses, payroll and connected books, and what you DECLARED — each labelled, because a founder acts on this number. Cashflow shows inflows, outflows and the ending balance month by month, as a chart and a table, for the observed months and for the projection at your declared burn. The same calculator runs free on the Business Intelligence page before you sign in, and carries your numbers into your workspace when you do.',
    'new',
    'live',
    '2026-09-15 12:01:00'
  )
ON CONFLICT (id) DO NOTHING;
