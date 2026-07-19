# PRD: Marketplace V2 — Commerce, Public API & Publisher Unification

**Date:** 2026-03-27
**Status:** In Progress
**Scope:** builderforce.ai frontend + api worker

---

## 1. Overview

Builderforce.ai's vision is to be the agentic platform where users create custom AI agents, publish them, and other users purchase/hire those agents. This PRD captures the V2 Marketplace feature set that moves from a read-only skill browser to a full commerce experience with a public developer API.

---

## 2. Goals

| Goal | Success Metric |
|------|---------------|
| Replace "Workforce" nav with "Marketplace" | Nav item visible to all users, not mobile-only |
| Public marketplace browsing (no login required) | /marketplace loads without auth, sidebar visible |
| Shopping cart | Cart icon in header; slide-out panel; add/remove items |
| Artifact pricing (flat-fee & consumption) | Price displayed on every listing; 0.00 = Free |
| Publisher unification | No separate Publisher Account; every user can publish |
| Public developer API | GET /api/v1/agents accessible with API token |
| Developer API access management | Users can request & manage developer API tokens |

---

## 3. Detailed Requirements

### 3.1 Navigation

**Change:** The "Workforce" sidebar item (MESH section) is replaced by a first-class "Marketplace" item in the MAIN section.

- The Marketplace nav item uses the 🛒 icon (matching the TopBar centre link).
- The `/marketplace` route is accessible without authentication; the AppShell sidebar renders for unauthenticated visitors on the marketplace route.
- The TopBar's centred "Marketplace" link remains as-is.

### 3.2 Public Marketplace Access

- `/marketplace` is browsable without login.
- When unauthenticated: browsing (search, filter, view listings) works fully.
- When unauthenticated: install/assign and like actions prompt login.
- When unauthenticated: "Add to Cart" works (cart persists in localStorage).
- Checkout requires authentication (cart slide-out prompts login if not authed).

### 3.3 Shopping Cart

**Header icon:** A cart icon (🛒 or SVG shopping bag) appears in the TopBar `topbar-right`, showing a badge with item count when non-empty.

**Slide-out panel:**
- Opens from the right when cart icon is clicked.
- Lists cart items: name, type badge (Skill / Persona / Content / Agent), price.
- Shows subtotal.
- "Checkout" button:
  - Authenticated: proceeds to payment flow (Stripe).
  - Unauthenticated: shows "Create an account or sign in to purchase" with links to /register and /login.
- "Remove" button per item.
- "Continue Shopping" to close.

**State:** Managed in `CartContext` (React context + localStorage persistence).

### 3.4 Artifact Pricing

Every marketplace artifact (skill, persona, content, workforce agent) has:

| Field | Type | Description |
|-------|------|-------------|
| `price` | `number` | Price in USD. 0 = free. |
| `pricingModel` | `'flat_fee' \| 'consumption'` | Flat-fee = one-time purchase. Consumption = per-request billing. |
| `priceUnit` | `string \| null` | Unit label for consumption (e.g. "per 1K tokens"). Null for flat-fee. |

**Display rules:**
- `price === 0` → show "Free" badge (green).
- `pricingModel === 'flat_fee'` → show "$X.XX" price chip.
- `pricingModel === 'consumption'` → show "$X.XX / per request" (or `priceUnit`).

**Creator controls (Publish tab):** Author sets price and pricing model when publishing/editing.

**DB:** `price` (numeric, default 0), `pricing_model` (enum: flat_fee | consumption, default flat_fee), `price_unit` (text, nullable) added to `marketplace_skills`. Same fields mirrored on `platform_personas`.

**Purchases table:** `marketplace_purchases` tracks completed transactions (userId, artifactType, artifactSlug, price, pricingModel, stripePaymentIntentId, createdAt).

### 3.5 Publisher Unification

**Before:** The Publish tab showed a separate "Publisher Account" login wall with its own email/password sign-in, separate from the main workspace login.

**After:** Any authenticated Builderforce.ai user can publish artifacts. The Publisher Account section is removed. The Publish tab:
- If unauthenticated: shows "Sign in to publish" message with links to /login and /register.
- If authenticated (main app user): shows the publish form directly, using the user's web JWT for marketplace API calls.
- Auto-bridges the web JWT into the marketplace token on mount.

### 3.6 Public Developer API

A public REST API allowing external sites to list and embed agents from Builderforce.ai.

**Base URL:** `https://api.builderforce.ai/api/v1/`

**Authentication:** Bearer token (`Authorization: Bearer <developer_api_key>`). Tokens are scoped to read-only public data.

**Endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/agents` | List published agents (paginated). Filterable by skill/tag/name. |
| GET | `/api/v1/agents/:id` | Get single agent details. |
| GET | `/api/v1/skills` | List published marketplace skills. |
| GET | `/api/v1/personas` | List built-in personas. |

**Request Developer Access:**
- In Settings → Developer API tab: user can request an API key.
- On approval (auto-approve for now): a key is generated and displayed once.
- Keys can be revoked.

**DB:** `developer_api_keys` table (id, userId, name, keyHash, lastUsedAt, revokedAt, createdAt).

---

## 4. Implementation Plan

### Phase 1: Navigation & Public Access (Frontend)
1. `Sidebar.tsx` — remove `mobileOnly` from Marketplace; remove Workforce from MESH.
2. `ConditionalAppShell.tsx` — already handles `/marketplace` (no change needed).

### Phase 2: Shopping Cart (Frontend)
3. `CartContext.tsx` (new) — cart items state + localStorage persistence.
4. `ShoppingCart.tsx` (new) — slide-out panel component.
5. `TopBar.tsx` — add cart icon button with badge.
6. `layout.tsx` — wrap with CartProvider.

### Phase 3: Pricing & Publisher Unification (Frontend + Backend)
7. `marketplaceData.ts` — add `price`, `pricingModel`, `priceUnit` to `BuiltinSkill`, `Persona`, `UserSkill`.
8. `marketplace/page.tsx` — remove Publisher Account gate; add price display; Add to Cart button.
9. `builderforceApi.ts` — update `MarketplaceSkill` type with price fields.
10. `schema.ts` — add price columns to `marketplace_skills`, add `marketplace_purchases` table.
11. `marketplaceRoutes.ts` — expose price in GET /skills; add POST /purchase; update publish to accept price.

### Phase 4: Public Developer API (Backend + Frontend)
12. `schema.ts` — add `developer_api_keys` table.
13. `publicApiRoutes.ts` (new) — read-only public endpoints.
14. `index.ts` — mount `/api/v1/*`.
15. `settings/page.tsx` or new Developer API settings section — key management UI.
16. DB migration SQL.

---

## 5. Non-Goals (V2)

- Agent consumption billing/metering (tracked usage) — V3.
- Marketplace curation/moderation workflow — V3.
- Revenue sharing / payouts to creators — V3.
- OAuth for developer API — V3.
