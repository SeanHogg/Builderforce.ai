# Maintenance

Existing customer obligations and critical defects. No new capability work. Detail is in [GAP-REGISTER.md](./GAP-REGISTER.md) under the `MAINT` prefix.

| Area | Disposition | Notes |
|---|---|---|
| Ceremonies and meetings | Maintenance | |
| Recruiting and ATS | Maintenance / deferred | Contractual obligations only |
| Finance dashboards | Maintenance | |
| Marketing campaign automation | Maintenance | |
| Collection views (PRD 47) | Maintenance | |
| Hired.video absorption (PRD 18) | Maintenance / cutover | Redirect shell, data preservation and contractual obligations still complete. Full feature parity needs an explicit business justification ([PRD 18](../specs/platform.md#prd-18--hiredvideo--builderforceai-port-cutover-and-retirement)). Every table maps to a primitive (`docs/specs/data-model/source-to-target.tsv`) |
| Data model consolidation (PRD 20) | Execution-critical work only | |
| General code health (PRD 22) | Execution-critical work only | |
| SEO and public product surfaces | P1 when supporting commercialization | Tracked as `COM` |

The preferred end state for specialized business capabilities is to package them as applications, agents or starter kits running on the WebContainer platform, rather than as core platform features.
