# Operator decisions and actions

Work only an operator can do: repository settings, secrets, provider accounts and production data access. Each row names the entry it unblocks. "Blocker" entries in the program files point here.

| Action | Unblocks | Needed |
|---|---|---|
| Add `BF_QA_EMAIL` and `BF_QA_PASSWORD` as **repository** secrets (Settings → Secrets and variables → Actions; `qa-e2e` has no `environment:`, so environment secrets are not visible to it), using a dedicated least-privilege QA account. Host confirmed: `https://builderforce.ai` (operator, 2026-11-25) | `REL-03` (without them the `qa-e2e` job goes red; it is advisory and does not fail the release) | Done (2026-11-25) |
| Enable branch protection on `main` and require the release checks | `REL-10`, `REL-G002` | GitHub repository settings |
| Grant read access to production run data for the autonomous baseline | `AE-01`, `AE-04` | A manager-role API token for the production tenant (`BF_API_TOKEN`, local env only) |
| Register the Stripe webhook and set `STRIPE_SECRET_KEY` and related secrets | `COM-01` (`COM-G001`) | Stripe account actions; can proceed in parallel with delivery |
| Provide `OVSX_PAT` (the Marketplace uses OIDC; `VSCE_PAT` is not needed) | `REL-G003`, `REL-07` | Done (2026-11-25) |
| Decide whether a red commit may publish to the CDN | `REL-G008` | Release order is currently deliberate |
| Provide a Cloudflare token scoped to the `builderforce.ai` zone (Zone Settings: Edit, WAF: Edit) | `HOST-G028` | Token |
| Complete the burnrateos.com provider actions, identity-cutover comms and redirect verification | [RETIREMENT.md](./RETIREMENT.md) | Provider actions |
| Approve the proposed allocation, schedule and targets in [00-STRATEGY.md](./00-STRATEGY.md) | All | Product decision |
