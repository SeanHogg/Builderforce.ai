> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #249
> _Each agent that updates this PRD signs its change below._

# PRD: pattysnob.com — Burger Discovery & Review Platform

## Problem & Goal

Burger enthusiasts lack a dedicated, opinionated space to discover, rate, and discuss burgers with the depth and seriousness that wine, coffee, or fine dining communities already enjoy. Generic review platforms (Yelp, Google Maps) flatten nuance into star ratings and mix burgers with hundreds of other menu items.

**Goal:** Launch pattysnob.com as the go-to destination for burger connoisseurs — offering structured reviews, discovery tools, and a community where quality, craft, and taste are taken seriously (with a self-aware sense of humor about it).

---

## Target Users / ICP Roles

| Role | Description |
|---|---|
| **The Snob** | Core user; seeks best-in-class burgers; wants granular ratings (bun, patty, sauce, assembly); posts detailed reviews |
| **The Explorer** | Casual enthusiast discovering new spots; uses filters and curated lists to plan meals |
| **The Restaurateur** | Burger joint owner or chef; claims listings, responds to reviews, showcases craft |
| **The Curator** | Power user or staff editor who builds ranked lists, guides, and features |

---

## Scope

### In Scope (v1)

- Burger and restaurant listing directory
- Structured review system with attribute-level scoring
- User accounts and profiles
- Search and filter/discovery tools
- Curated editorial lists and rankings
- Basic SEO-optimized public pages

### Out of Scope (see section below)

- Reservations or ordering integrations
- Mobile native apps
- Paid advertising / promoted listings
- Franchise / chain-level data aggregation at scale

---

## Functional Requirements

### 1. Listing & Directory

- **FR-1.1** Every burger entry has: name, restaurant, location (city/neighborhood), price, patty type(s), cook level options, and photos.
- **FR-1.2** Restaurant profiles include address, hours, website link, social links, and a curated gallery.
- **FR-1.3** Listings are searchable by city, neighborhood, patty type (beef, smash, veggie, etc.), price range, and rating.
- **FR-1.4** Editors and verified users can submit new listings; submissions enter a moderation queue.

### 2. Review System

- **FR-2.1** Authenticated users can submit one review per burger entry.
- **FR-2.2** Each review captures attribute scores (1–10) for: **Patty**, **Bun**, **Sauce/Toppings**, **Value**, **Overall**.
- **FR-2.3** A composite "Snob Score" is calculated as a weighted average of attribute scores across all reviews.
- **FR-2.4** Reviews support free-text write-up (min 50 characters) and up to 5 photo uploads.
- **FR-2.5** Reviews can be upvoted/downvoted by other authenticated users.
- **FR-2.6** Restaurateurs with claimed listings can post a single public response to any review.

### 3. User Accounts & Profiles

- **FR-3.1** Sign-up via email/password and OAuth (Google, Apple).
- **FR-3.2** Public profile displays: username, avatar, review count, "burgers tried" count, home city, and top badges.
- **FR-3.3** Users can maintain a personal **Burger Bucket List** (saved burgers to try).
- **FR-3.4** Users earn badges for milestones (e.g., First Review, 10 Reviews, Certified Snob at 50 Reviews).

### 4. Discovery & Search

- **FR-4.1** Homepage features a hero search bar (location + keyword) and curated spotlight sections.
- **FR-4.2** Faceted filter panel: patty type, price range, Snob Score threshold, distance (geolocation opt-in), dietary tags (halal, kosher, gluten-free bun available).
- **FR-4.3** City landing pages aggregate top-rated burgers and featured restaurants per metro area.
- **FR-4.4** "Near Me" discovery uses browser geolocation to surface nearby listings sorted by Snob Score.

### 5. Curated Lists & Editorial

- **FR-5.1** Curators and editors can publish ranked lists (e.g., "Top 10 Smash Burgers in Chicago").
- **FR-5.2** Lists support a cover image, intro copy, ordered burger entries with editor notes, and a publish date.
- **FR-5.3** Lists are shareable via unique URL and open-graph-optimized for social sharing.

### 6. Claiming & Restaurateur Tools

- **FR-6.1** Restaurateurs can submit a claim request for a listing with business verification (email domain or document upload).
- **FR-6.2** Claimed listings display a "Verified" badge and allow the owner to update hours, photos, and description.
- **FR-6.3** Restaurateurs receive email notifications when a new review is posted on their listing.

---

## Acceptance Criteria

| ID | Criterion |
|---|---|
| **AC-1** | A user can find a burger listing by searching a city name and see results within 2 seconds on a standard connection. |
| **AC-2** | Submitting a review with all five attribute scores and ≥50-character text successfully saves and immediately appears on the burger's page. |
| **AC-3** | The Snob Score on a burger page updates to reflect the new review within 60 seconds of submission. |
| **AC-4** | A new user can complete sign-up via Google OAuth and reach their profile page in under 3 clicks. |
| **AC-5** | A curator can publish a ranked list and the resulting URL renders with correct open-graph metadata when previewed in a social link validator. |
| **AC-6** | A restaurateur claim request triggers a confirmation email within 5 minutes and surfaces in the admin moderation queue. |
| **AC-7** | All public listing and review pages achieve a Lighthouse SEO score ≥ 90. |
| **AC-8** | Dietary filter tags correctly exclude listings that do not carry the selected tag (zero false positives in QA test set of 50 listings). |

---

## Out of Scope

- Native iOS / Android applications (v1 is web-only; responsive mobile web is in scope)
- Online ordering, delivery, or reservation integrations
- Paid / promoted listing tiers or advertising inventory
- Automated data ingestion from third-party APIs (Yelp, Google Places) — all listings are human-curated in v1
- Multi-language / internationalization support
- Nutritional or calorie information tracking
- User-to-user direct messaging
- Franchise or chain-level analytics dashboards