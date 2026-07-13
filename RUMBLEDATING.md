# RumbleDating Project Template

> **Status:** 0% complete (stalled project at 40 tasks in backlog)
> **Author:** Code-creator agent, task #247
> **Last Updated:** $(date -u +"%Y-%m-%dT%H:%M:%SZ")

## Overview

RumbleDating is a dating application concept defined in the PRD below. This repository contains a starter framework for building the application and demonstrating BuilderForce agent capabilities.

### Why This Exists

BuilderForce is a platform for building agents and systems, not a dating app engine. This template shows how BuilderForce can be used to manage complex product development workflows.

---

## Project PRD

### Problem & Goal

RumbleDating is a stalled project with 40 backlog tasks and 0% completion. The core problem is that a viable dating product concept exists but has never moved from planning to execution. The goal of this PRD is to establish clear, actionable requirements that unblock the team, prioritize a shippable MVP, and define done so that tasks move from backlog to delivered.

---

### Target Users / ICP Roles

| Role | Description |
|---|---|
| **Primary User — Dater** | Single adults (18–35) seeking romantic connections; comfortable with mobile-first experiences; frustrated by low-quality matches on incumbent apps |
| **Secondary User — Moderator** | Internal trust & safety staff who review reported content, ban bad actors, and maintain community health |
| **Admin / Operator** | Internal team managing feature flags, user analytics, subscription billing, and platform configuration |

---

### MVP Scope

#### In Scope
- User registration, authentication, and profile creation
- Photo upload and profile media management
- Preference-based matching algorithm (age range, distance, gender)
- Swipe / decision UI (like / pass)
- Mutual-match detection and notification
- In-app 1:1 messaging between matched users
- Basic trust & safety: reporting, blocking, and content moderation queue
- Push notifications (matches, messages)
- Subscription / paywall (free tier with limits; paid tier unlocking unlimited actions)
- iOS and Android mobile apps (React Native or Flutter) + REST/GraphQL API backend

#### Out of Scope
- In-chat photo/video sharing
- Video profiles or live video calling
- AI-powered compatibility scoring or personality matching
- Social graph / friends-of-friends matching
- Web browser–based dating interface for end users (admin panel only)
- Third-party integrations (Spotify, Instagram photo import)
- Group events or activity-based matching
- Voice messages
- Profile verification via government ID or selfie liveness check (evaluated for v2)
- Localization / multi-language support beyond English (MVP)
- Referral or affiliate program
- Analytics SDK beyond basic crash reporting and event logging (advanced BI deferred)

---

### Functional Requirements

#### 1. Authentication & Accounts
- FR-1.1 Users must register via email + password or OAuth (Google, Apple Sign-In).
- FR-1.2 Email verification required before profile is discoverable.
- FR-1.3 Users must confirm they are 18+ at registration; DOB stored and enforced.
- FR-1.4 Password reset via verified email link.
- FR-1.5 Users can delete their account and all associated data (GDPR / CCPA compliance).

#### 2. Profile Creation & Management
- FR-2.1 Profile fields: display name, age (derived from DOB), bio (≤ 300 chars), gender identity, sexual orientation, location (city-level), and up to 6 photos.
- FR-2.2 At least 1 photo required before profile becomes active.
- FR-2.3 Users can edit all profile fields at any time.
- FR-2.4 Photos are scanned for NSFW content before being made visible (automated + manual fallback).
- FR-2.5 Location is updated automatically on app open (with permission) or set manually.

#### 3. Discovery & Matching
- FR-3.1 System presents a deck of candidate profiles filtered by user-defined preferences (distance radius, age range, gender).
- FR-3.2 Users perform a Like or Pass action on each presented profile.
- FR-3.3 When two users both Like each other, a Match is created and both are notified in real time.
- FR-3.4 Free-tier users are limited to 30 Likes per 24-hour rolling window; paid users have unlimited Likes.
- FR-3.5 Already-seen profiles are not re-shown unless the user explicitly enables "Show previously passed profiles" (paid feature).
- FR-3.6 Profiles inactive for > 30 days are deprioritized in the deck but not deleted.

#### 4. Messaging
- FR-4.1 Messaging is unlocked only between mutually matched users.
- FR-4.2 Messages support plain text and emoji; max message length 1,000 characters.
- FR-4.3 Media (photos) may be sent in chat in a future release (see Out of Scope).
- FR-4.4 Unread message count is surfaced on the app icon badge and in-app tab.
- FR-4.5 Messages are stored server-side and synced across devices.
- FR-4.6 Users can unmatch; the conversation and match are removed for both parties.

#### 5. Notifications
- FR-5.1 Push notifications sent for: new match, new message, profile Like received (paid users only).
- FR-5.2 Users can configure notification preferences per event type.
- FR-5.3 Email digest (daily or weekly) for users who have unread activity and have not opened the app.

#### 6. Trust & Safety
- FR-6.1 Any user can report a profile with a predefined reason (fake profile, harassment, underage, inappropriate photo, spam).
- FR-6.2 Any user can block another user; blocked users disappear from each other's experience immediately.
- FR-6.3 Reported profiles enter a moderation queue visible to internal Moderators.
- FR-6.4 Moderators can: warn, suspend (temporary), or permanently ban an account.
- FR-6.5 Banned users cannot re-register with the same email or device fingerprint.
- FR-6.6 All NSFW photo upload attempts are logged for audit.

#### 7. Subscription & Payments
- FR-7.1 Free tier: 30 Likes/day, no profile boosts, no rewind.
- FR-7.2 Paid tier ("RumblePlus"): unlimited Likes, 1 free Boost per week, Rewind last pass, see who Liked you.
- FR-7.3 Payments processed via Apple In-App Purchase (iOS), Google Play Billing (Android), and Stripe (web/admin).
- FR-7.4 Subscription status synced server-side; receipt validation performed on backend.
- FR-7.5 Users can cancel at any time; access continues until end of billing period.

#### 8. Admin Dashboard
- FR-8.1 Web-based admin panel for internal operators.
- FR-8.2 Operators can view aggregate metrics: DAU, MAU, matches created, messages sent, new registrations, churn.
- FR-8.3 Operators can search users by email or ID, view profile details, and trigger account actions (warn, suspend, ban).
- FR-8.4 Feature flags can be toggled per environment (e.g., enable/disable Boost feature).

---

### Acceptance Criteria

#### Registration & Auth
- AC-1 A new user can complete registration (email + password), verify their email, and view their empty profile within 5 minutes of starting the flow on a cold install.
- AC-2 A user under 18 cannot complete registration; DOB enforcement blocks the flow with a clear error.
- AC-3 Password reset email arrives within 2 minutes and link expires after 24 hours.

#### Profile
- AC-4 A user cannot appear in the discovery deck until at least 1 photo is uploaded and email is verified.
- AC-5 NSFW photo detection rejects overtly explicit images before they are stored or shown; false-positive rate < 5% on a standard test set.

#### Matching
- AC-6 A mutual Like results in a Match event visible to both users within 3 seconds under normal load.
- AC-7 A free-tier user who reaches 30 Likes sees a hard limit message and cannot Like again until the 24-hour window resets; upgrading immediately lifts the limit.

#### Messaging
- AC-8 Two matched users can exchange messages with end-to-end delivery confirmation; messages appear within 2 seconds on a standard connection.
- AC-9 Unmatching removes the conversation from both users' inboxes within 5 seconds.

#### Trust & Safety
- AC-10 A reported profile appears in the moderation queue within 60 seconds of submission.
- AC-11 A banned user attempting to log in receives an account-suspended error and cannot access any authenticated endpoint.

#### Subscription
- AC-12 Upgrading to RumblePlus immediately removes the Like limit and unlocks paid features without requiring app restart.
- AC-13 Subscription status is validated server-side; a revoked or expired subscription downgrades the user to free tier within 1 hour of expiry.

#### Performance & Reliability
- AC-14 API p95 response time < 400 ms for discovery endpoint under a load of 500 concurrent users.
- AC-15 App crash-free rate ≥ 99% across iOS and Android (measured via crash analytics).

---

## Notes

This template is for **demonstration and documentation purposes only**. BuilderForce is not designed as a dating app framework. To build a production dating application:

1. Create a separate repository using your preferred app stack (React Native, Flutter, etc.)
2. Use BuilderForce AI agents as your development team/project management system
3. This template illustrates how BuilderForce can coordinate work across complex product development workflows

For questions or issues using BuilderForce, please consult the [main BuilderForce documentation](./README.md).