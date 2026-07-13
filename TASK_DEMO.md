# RumbleDating Sample Tasks

## Overview

This document provides sample tasks, organized by agent persona, to demonstrate how BuilderForce can manage a complex product development workflow for RumbleDating.

---

## Agent: client-experience-designer

### Task: Design validation badge affordance
**Epic:** UI Basics
**Priority:** high
**Effort:** 5 points
**Description:** As client-experience-designer, design 3 variations for showing validation status on profile photos:
- Option 1: Simple checkmark icon (neutral background)
- Option 2: Color-coded badge (green = verified, yellow = pending, red = rejected)
- Option 3: Underline/stroke animation (only on final accepted photo)
Include mockups or visual description for each option and accessibility notes for colorblind users.

---

### Task: Draft onboarding sequence for registration completion
**Epic:** Authentication & User Onboarding
**Priority:** high
**Effort:** 3 points
**Description:** As client-experience-designer, create 7 messages for the first-time user:
1. Post-registration success
2. After email verification
3. After DOB confirmation
4. After profile photo upload
5. After bio completion
6. First swipe action feedback
7. First match celebration screen
Each message: friendly tone, under 50 characters max for iOS, include emoji where appropriate.

---

### Task: Prototype message thread left-aligned vs right-aligned
**Epic:** Messaging
**Priority:** medium
**Effort:** 3 points
**Description:** As client-experience-designer, create side-by-side mockups comparing:
- Option A: Left-aligned bubbles for self, right-aligned for others (like WhatsApp/iMessage)
- Option B: Centered bubbles for all, with "You" label (like Telegram)
- Option C: Avatar medallions with bubbles connected (like some niche apps)
Provide pros/cons for each approach.

---

## Agent: product-tester

### Task: Test registration deadline enforcement for users under 18
**Epic:** Authentication & Accounts
**Priority:** high
**Effort:** 3 points
**Description:** As product-tester, manually execute registration flow with DOB that results in age < 18:
1. Try setting DOB before 18 years ago using different timezones
2. Verify error message displayed is clear and not ambiguous
3. Confirm users cannot proceed to profile without fixing DOB
4. Test mobile age validation if provided
Document exact error text and screenshots. Also test that an adult still sees full registration flow.

---

### Task: Validate Like limit enforcement for free tier
**Epic:** Discovery & Matching
**Priority:** high
**Effort:** 5 points
**Description:** Execute AC-7 (free-tier Like limit enforcement):
1. Create 2 free-tier accounts
2. Set up matching scenario where User A reaches 30 Likes
3. Note exact error message and UI state
4. Verify User A cannot Like more profiles for 23 hours and 59 minutes
5. Confirm User A can still Pass profiles (not subject to limit)
6. Test that upgrading to paid tier immediately lifts the limit without requiring app restart

Provide step-by-step reproduction and timeline confirmation.

---

### Task: Test crash-free rate metric collection
**Epic:** Performance & Reliability
**Priority:** high
**Effort:** 3 points
**Description:** As product-tester, manually trigger crashes to validate detection:
1. Use developer options to simulate background process termination
2. Force quit app while logged in AND while in matching deck
3. Restart app and verify crash analytics includes:
   - App version
   - Device model and OS
   - Crash timestamp and stack trace
   - User flow leading to crash (before/after X screens)
Report any missing data.

---

## Agent: platform-marketer

### Task: Draft launch-day announcement campaign
**Epic:** Launch & Marketing
**Priority:** high
**Effort:** 8 points
**Description:** As platform-marketer, create a multi-channel launch campaign (1 week):
- Twitter/X thread (3 posts)
- Instagram caption + hashtag suggestions
- LinkedIn post targeting professionals
- Press release template
Each piece: excitement-focused, includes safety claims, mentions 'This week: 30 Likes/day free for all new users'

---

### Task: Write onboarding email sequence
**Epic:** User Onboarding & Retention
**Priority:** medium
**Effort:** 5 points
**Description:** As platform-marketer, draft 4 emails for new signups:
1. Welcome + app download links (iOS/Android)
2. 'Complete your profile' reminder (day 2)
3. 'It's a match!' teaser with referrals (day 5)
4. Safety tips + feature intro (day 7)
Each: Subject line and body, tone professional but engaging, include CTAs that redirect to in-app features.

---

### Task: A/B test notification framing for matches
**Epic:** Push Notifications
**Priority:** medium
**Effort:** 7 points
**Description:** As platform-marketer, design 3 offer frameworks for match notifications:
- Framework 1: Concise (e.g., "It's a match! Sarah liked you back")
- Framework 2: Curiosity (e.g., "You matched! + who is next?")
- Framework 3: Value-add (e.g., "It's a match! See 5 more profiles free for 24h")
Define metric goals (click-through rate, message opening, profile completion) and test duration (2 weeks, 10k impressions each variant).

---

## Agent: safety-moderator

### Task: Define moderation taxonomy and escalation paths
**Epic:** Trust & Safety
**Priority:** high
**Effort:** 10 points
**Description:** As safety-moderator, create comprehensive guidelines:
1. Define 10 typical report reasons with subcategories (e.g., "Harassment: threats, insults, unwanted sexual content")
2. Create step-by-step escalation playbooks for each reason
3. Attach screenshot examples for common violations (faces/identities, info scraping)
4. Write operating procedures for auto-ban decisions after 3 harassment reports
5. Document handling of underage accounts
Deliver in searchable format (document with internal links, searchable content)

---

### Task: Analyze report queue patterns and recommend feature improvements
**Epic:** Trust & Safety
**Priority:** medium
**Effort:** 6 points
**Description:** As safety-moderator, process recent reports and produce improvements:
1. Review 50 randomly selected reports with category mismatch or unclear reasons
2. Identify common false positives and false negatives
3. Suggest 3 UI improvements to reporting reasons dropdown
4. Recommend new categories based on emerging patterns (e.g., "Ghosting spam")
Document recommendations in concise plan with rationale.

---

### Task: Review and approve ban appeals policy
**Epic:** Trust & Safety
**Priority:** low
**Effort:** 4 points
**Description:** As safety-moderator, audit the ban appeal process:
1. Read existing appeals FAQ (8 common questions)
2. Evaluate clarity, tone, and legal safety
3. Check if appeals timeline is documented
4. Ensure appeal email template includes confidentiality notice
Make 5 improvements to increase transparency and reduce escalation to external complaints.

---

## Agent: fullstack-dev

### Task: Create messages table with real-time sync support
**Epic:** Messaging Backend
**Priority:** high
**Effort:** 15 points
**Description:** As fullstack-dev, design and implement:

**Database:**
```sql
CREATE TABLE messages (
  id SERIAL PRIMARY KEY,
  match_id INTEGER REFERENCES matches(id) NOT NULL,
  sender_id INTEGER REFERENCES users(id) NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ
);

CREATE INDEX idx_messages_match_created ON messages(match_id, created_at DESC);
```

**API Endpoint:**
- `POST /api/messages/:matchId` — create message
- `GET /api/messages/:matchId?after=timestamp` — sync new messages
- `PUT /api/messages/:id/read` — mark as read

**Real-time:**
- WebSocket endpoint: `ws://api/messages/:matchId`
- Emit 'message.new' payload when new message arrives

---

### Task: Implement subscription status synchronization
**Epic:** Billing & Subscriptions
**Priority:** high
**Effort:** 12 points
**Description:** As fullstack-dev, set up billing integration:

**Backend:**
- Backend webhook endpoint for payment status changes
- Validate receipts via Apple IAP / Google Play Billing
- Sync membership status to users table: `is_paid_subscription BOOLEAN`, `subscription_renewal_date TIMESTAMPTZ`

**Rate-limited Gateway:**
- Debounce Apple IAP webhooks to avoid duplicate processing
- Cache transient IAP statuses with TTL
- Expose health check: `GET /api/health/billing-status`

**Error Handling:**
- Log all subscription changes with user_id, subscription_id, events, and delta
- Retry webhook processing on temporary failures (exponential backoff)
- Expose metrics: 'webhook.handled', 'subscription.status.updated'

---

### Task: Build profile photo upload with NSFW scanning
**Epic:** Profile & Media Management
**Priority:** high
**Effort:** 20 points
**Description:** As fullstack-dev, implement secure photo upload:

**Frontend (React Native):**
- Multi-photo selection with 6-photo limit
- Image compression before upload (utilization of device camera quality)
- Thumbnail preview of selected photos

**Backend:**
- Private s3 bucket for profiles with granular access control per user
- Image optimization pipeline: resize to max 1080px dimension, format conversion to JPEG/WebP
- NSFW scanning via external API (e.g., Sentinel / VisibleBlack)
- Return `status: "pending_review" | "approved" | "rejected"` + confidence score

**API:**
- `POST /api/profile-photos` (upload single)
- `GET /api/profile-photos?include_pending=true` (owner only)
- `DELETE /api/profile-photos/:id` (owner only)

**Audit Logging:**
- Log all photo upload attempts: user_id, file_hash, detect_sfw_score, timestamp
- Retention: 1 year for admin review, permanently for banned users (per GDPR requirement)

---

## Sample Epic Structure

### Epic: Authentication & User Onboarding

**Sub-tasks (prioritized):**
1. Create users table with DOB and age-enforcement trigger (fullstack-dev: high)
2. Implement email verification flow (fullstack-dev: high)
3. Build iOS/Android age-gate screens with clear error messages (fullstack-dev: high)
4. Test registration deadline enforcement for users under 18 (product-tester: high)
5. Design onboarding sequence for registration completion (client-experience-designer: high)
6. Create password reset flow with time-limited token (fullstack-dev: medium)
7. Test password reset email delivery timeframes (product-tester: medium)

---

### Epic: Matching Algorithm

**Sub-tasks:**
1. Define preference-based filter criteria (fullstack-dev: high)
2. Build candidate profile filtering API with distance calculation (fullstack-dev: high)
3. Implement swipe deck UI (like/pass) (fullstack-dev: high)
4. Create mutual-match detection service (fullstack-dev: high)
5. Add real-time match notifications to websocket (fullstack-dev: medium)
6. Design swipe card animations and feedback (client-experience-designer: high)
7. Validate matching performance (AC-14) under load (product-tester: high)

---

## Notes

These sample tasks demonstrate typical BuilderForce workflows. Actual implementation tasks will vary based on tech stack decisions (React Native vs. Flutter), third-party services chosen (Push notifications via Firebase, NSFW scanning API, payment providers), and project constraints.

**Next Steps:**
1. Choose primary mobile framework: React Native or Flutter
2. Select backend runtime: Node.js/Express, FastAPI (Python), or standalone API gateways
3. Configure project board with swimlanes matching the agent personas above
4. Contribute critical user stories from backlog grooming session

---