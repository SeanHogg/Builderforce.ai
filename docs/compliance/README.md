# BuilderForce compliance control index

Owner: Fix Faster LLC dba BuilderForce.ai, 6513 Basswood Dr., Troy, MI 48098. Review cadence: quarterly and before material high-risk changes. These records are audit evidence, not a claim that a template alone establishes legal compliance.

| Control | Evidence | Release gate |
|---|---|---|
| Privacy rights | `privacy-rights-fulfillment.md`, `/api/auth/me/privacy-*` | Exercise quarterly with a test account |
| Consent/GPC | `CookieConsentManager.tsx`, cookie policy | Browser matrix test; GTM absent before opt-in |
| Processors/transfers | `subprocessor-register.md`, `data-processing-addendum.md`, `international-data-transfer-assessment.md` | Procurement review before enablement |
| Assessments/incidents | `dpia-state-admt-assessment.md`, `privacy-incident-response.md` | Required change-review check |
| AI transparency | public AI page, approval gates, assessment | High-impact uses prohibited without review |
| Minors/sensitive data | `minor-safety-coppa-colorado.md`, registration gate | Adult attestation and red-team review |
| Accessibility | `accessibility-wcag-2.2-audit.md`, Playwright test | No serious/critical automated violations |

The Compliance Audit Agent must treat missing evidence, stale review dates, placeholder language, or a failing executable check as a ticket—not as a passing control.
