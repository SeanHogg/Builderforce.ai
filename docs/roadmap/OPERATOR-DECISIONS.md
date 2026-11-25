# Operator decisions and actions

Work only an operator can do: repository settings, secrets, provider accounts and production data access. Each row names the entry it unblocks. "Blocker" entries in the program files point here.

| Action | Unblocks | Needed |
|---|---|---|
| Add `BF_QA_EMAIL` and `BF_QA_PASSWORD` repository secrets, and confirm `https://builderforce.ai` as the frontend host for `qa-e2e` | `REL-03` (the `qa-e2e` job fails without them, by design) | Secrets and one confirmation |
| Enable branch protection on `main` and require the release checks, including `qa-e2e` | `REL-10`, `REL-G002` | GitHub repository settings |
| Grant read access to production run data for the autonomous baseline | `AE-01`, `AE-04` | Read-only credentials or an exported query result |
| Register the Stripe webhook and set `STRIPE_SECRET_KEY` and related secrets | `COM-01` (`COM-G001`) | Stripe account actions; can proceed in parallel with delivery |
| Provide `VSCE_PAT` and `OVSX_PAT` | `REL-G003`, `REL-07` | Marketplace tokens |
| Decide whether a red commit may publish to the CDN | `REL-G008` | Release order is currently deliberate |
| Provide a Cloudflare token scoped to the `builderforce.ai` zone (Zone Settings: Edit, WAF: Edit) | `HOST-G028` | Token |
| Complete the burnrateos.com provider actions, identity-cutover comms and redirect verification | [RETIREMENT.md](./RETIREMENT.md) | Provider actions |
| Approve the proposed allocation, schedule and targets in [00-STRATEGY.md](./00-STRATEGY.md) | All | Product decision |
