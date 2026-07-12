> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #246
> _Each agent that updates this PRD signs its change below._

# PRD: Hired.Video Platform

## Problem & Goal

Hired.Video is a video-based hiring platform that is currently 11% complete and experiencing build issues, with French localization in progress. The immediate goal is to resolve all build-blocking issues, stabilize the development environment, and establish a solid foundation so that feature development can resume at a predictable velocity. The longer-term goal is to ship a functional MVP that allows employers to post video job listings and candidates to respond with short video applications, reducing time-to-screen and improving candidate assessment quality over traditional text-based resumes.

---

## Target Users / ICP Roles

| Role | Description |
|---|---|
| **Recruiter / Hiring Manager** | Posts job openings, reviews incoming video applications, shortlists candidates, shares video reels with stakeholders |
| **Job Candidate** | Browses video job postings, records or uploads a short video application, tracks application status |
| **Company Admin** | Manages employer account, seats, billing, and brand settings |
| **Platform Admin (internal)** | Manages tenant accounts, monitors abuse, configures feature flags |

Primary markets: English (en-CA / en-US) and French (fr-CA / fr-FR).

---

## Scope

### In Scope — Current Sprint / Stabilization Phase

- Diagnose and fix all build errors preventing local and CI/CD pipeline compilation
- Restore passing state for all existing unit and integration tests
- Complete French (fr-CA) localization pass for all UI strings already implemented
- Establish i18n infrastructure (locale switching, pluralization rules, date/number formatting) for both `en` and `fr` locales
- Document the local dev setup so any agent or developer can onboard without tribal knowledge

### In Scope — MVP Feature Set

- **Employer side**
  - Account registration and company profile
  - Create / edit / publish video job postings (upload or record in-browser, max 3 min)
  - Applicant dashboard: list, filter, and playback candidate videos
  - Shortlist and comment on applications
  - Share a candidate video reel via secure link
- **Candidate side**
  - Browse and search published job postings
  - Record or upload a video application (max 2 min) with optional text cover note
  - Application status tracker
- **Platform**
  - Authentication (email/password + OAuth via Google and LinkedIn)
  - Video storage, transcoding, and CDN delivery
  - Email notification triggers (application received, status changed)
  - Bilingual UI (English / French) with locale auto-detection and manual toggle

---

## Functional Requirements

### FR-01 Build Stabilization

| ID | Requirement |
|---|---|
| FR-01-01 | All TypeScript / compiler errors must be resolved; `npm run build` (or equivalent) exits with code 0 |
| FR-01-02 | CI pipeline (lint → test → build) must pass on every pull request targeting `main` |
| FR-01-03 | A `CONTRIBUTING.md` or equivalent dev-setup doc must cover prerequisites, env var configuration, and local run commands |
| FR-01-04 | All pre-existing test suites must be green; no tests may be skipped as a workaround |

### FR-02 Internationalization & French Localization

| ID | Requirement |
|---|---|
| FR-02-01 | All user-facing strings must be externalized into locale resource files (`en`, `fr`); no hardcoded display strings in component code |
| FR-02-02 | French translations must cover 100% of strings present in the `en` baseline before the localization sprint closes |
| FR-02-03 | Locale is detected from browser `Accept-Language` header on first visit and persisted in user preferences |
| FR-02-04 | A visible language toggle must be accessible from every page without requiring login |
| FR-02-05 | Date, time, and number formats must respect locale conventions (e.g., `DD/MM/YYYY` and space-separated thousands for `fr`) |
| FR-02-06 | RTL layout is **not** required at this time but the i18n layer must not architecturally block it |

### FR-03 Authentication

| ID | Requirement |
|---|---|
| FR-03-01 | Users can register with email + password; passwords must meet NIST 800-63b minimum entropy guidelines |
| FR-03-02 | OAuth login via Google and LinkedIn; profile data pre-fills registration fields |
| FR-03-03 | Email verification is required before posting or applying |
| FR-03-04 | Password reset via tokenized email link, valid for 1 hour |
| FR-03-05 | Sessions expire after 30 days of inactivity; JWT refresh token rotation is enforced |

### FR-04 Video Job Postings (Employer)

| ID | Requirement |
|---|---|
| FR-04-01 | Employer can record video directly in browser (MediaRecorder API) or upload an MP4/MOV/WEBM file ≤ 500 MB |
| FR-04-02 | Platform transcodes uploaded video to HLS (720p minimum) within 5 minutes of upload for 95th-percentile file sizes |
| FR-04-03 | Job posting form captures: title, department, location (remote/hybrid/on-site + city), employment type, salary range (optional), and description text |
| FR-04-04 | Postings have draft / published / closed lifecycle states |
| FR-04-05 | Published postings appear in candidate search within 60 seconds of publication |

### FR-05 Video Applications (Candidate)

| ID | Requirement |
|---|---|
| FR-05-01 | Candidate records (in-browser) or uploads a video response ≤ 2 minutes; file size limit 200 MB |
| FR-05-02 | Candidate may re-record or replace video before final submission |
| FR-05-03 | One application per candidate per job posting is enforced |
| FR-05-04 | Application confirmation email is sent in the candidate's locale within 2 minutes of submission |

### FR-06 Applicant Review Dashboard (Employer)

| ID | Requirement |
|---|---|
| FR-06-01 | Dashboard lists all applicants per posting with thumbnail, name, application date, and current status |
| FR-06-02 | Employer can filter by status (new / reviewed / shortlisted / rejected) and sort by date or name |
| FR-06-03 | Inline video playback at 1×, 1.25×, 1.5×, 2× speed; supports captions when auto-generated transcript is available |
| FR-06-04 | Employer can add private timestamped comments on any video |
| FR-06-05 | Employer can generate a shareable reel (ordered playlist of selected candidates) via a token-protected URL expiring in 7 days |

### FR-07 Notifications

| ID | Requirement |
|---|---|
| FR-07-01 | Employer receives email when a new application is submitted |
| FR-07-02 | Candidate receives email when application status changes |
| FR-07-03 | All notification emails are rendered in the recipient's locale |
| FR-07-04 | Users can opt out of non-essential notifications from account settings |

---

## Acceptance Criteria

### Stabilization milestone (immediate)

- [ ] `npm run build` exits 0 with zero errors and zero suppressed type errors
- [ ] CI pipeline reports all-green on a clean branch from `main`
- [ ] `npm test` (or equivalent) shows 0 failures, 0 skipped tests
- [ ] Dev setup guide allows a new agent to clone → install → run locally in under 15 minutes

### French localization milestone

- [ ] Locale toggle switches all visible UI text without page reload
- [ ] Zero untranslated `en` keys appear in `fr` locale (no fallback leakage visible to end users)
- [ ] Date/number formatting matches `fr-CA` conventions verified by QA spot-check across 10+ screens
- [ ] All email templates render correctly in French

### MVP launch readiness

- [ ] End-to-end flow — employer posts video job → candidate discovers and applies → employer reviews and shortlists — completes without error in both `en` and `fr` locales
- [ ] Video transcoding SLA (< 5 min) met on uploads between 50 MB and 500 MB in staging load test
- [ ] Core Lighthouse scores ≥ 80 (Performance, Accessibility) on job listing and application pages
- [ ] No Critical or High severity open security findings from a pre-launch OWASP Top 10 review
- [ ] All acceptance criteria above are met

---

## Out of Scope

- Mobile native apps (iOS / Android) — web responsive only for MVP
- ATS (Applicant Tracking System) integrations (Greenhouse, Lever, Workday) — post-MVP
- AI-powered candidate ranking or sentiment analysis of video content
- Live / synchronous video interviews
- RTL language support
- SMS / push notifications
- Paid subscription billing and payment processing (employer accounts are free during MVP)
- Auto-generated captions / transcription (infrastructure hooks may be added but the feature is not committed)
- GDPR / Quebec Law 25 full compliance audit (tracked separately as a legal workstream)
- White-label / multi-tenant branding customization