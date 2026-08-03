> **PRD** — drafted by Ada (Sr. Product Mgr) · task #1226
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document (PRD) for Builderforce.ai Payments/Escrow Integration

## Problem & Goal

### Problem
The current implementation of Builderforce.ai lacks the necessary infrastructure and codebase to support payments and escrow functionality, which is critical for the platform's marketplace operations. This gap prevents the implementation of essential features related to transactions, invoicing, and secure payments.

### Goal
Bind the correct Builderforce.ai repository that contains the API worker and frontend components required for implementing Stripe Connect payments and escrow functionality. This will enable the development and deployment of payment processing, invoicing, and secure transaction handling within the platform.

## Target Users / ICP Roles
- **Freelancers**: Users who offer services on the platform and need to receive payments for their work.
- **Clients**: Users who hire freelancers and need to make payments for services rendered.
- **Administrators**: Platform operators who need to manage transactions, resolve disputes, and ensure compliance with payment regulations.

## Scope

### In-Scope
- **API Worker Integration**: Bind the repository containing the Builderforce.ai API worker to handle payment intents, webhooks, and transaction processing.
- **Frontend Components**: Integrate frontend components for the checkout process, invoice generation, and escrow management.
- **Stripe Connect Implementation**: Set up Stripe Connect to facilitate secure payments and manage platform and user transactions.
- **Escrow Functionality**: Implement escrow services to hold funds until services are completed and both parties are satisfied.
- **Database Migrations**: Create and manage the `freelancer_invoices` table and other necessary database schemas.
- **Security and Compliance**: Ensure all payment processes comply with relevant security standards and regulations.

### Out-of-Scope
- **Custom Payment Gateways**: Integration of payment gateways other than Stripe Connect.
- **Advanced Financial Reporting**: Detailed financial analytics and reporting tools.
- **Multi-Currency Support**: Handling transactions in multiple currencies beyond the initial implementation.
- **Refunds and Disputes Management**: Automated handling of refunds and disputes (to be addressed in future iterations).

## Functional Requirements

1. **Repository Binding**
   - Bind the correct Builderforce.ai repository containing the API worker and frontend components.
   - Verify the presence of key files and directories related to payments and escrow.

2. **API Worker Setup**
   - Implement payment intent endpoints for handling Stripe transactions.
   - Set up webhook handlers for processing payment updates and notifications.
   - Integrate with the existing agent-runtime monorepo for seamless communication.

3. **Frontend Integration**
   - Develop checkout UI components for initiating payments and setting up escrow.
   - Implement invoice generation and display features for freelancers and clients.
   - Integrate with CartContext for managing transaction states.

4. **Stripe Connect Integration**
   - Configure Stripe Connect to manage platform and user accounts.
   - Implement secure payment processing and transaction handling.
   - Ensure compliance with Stripe's security and regulatory requirements.

5. **Escrow Management**
   - Implement escrow services to hold funds until services are completed.
   - Provide interfaces for releasing funds and resolving disputes.
   - Integrate with the existing chat-channel extensions for communication during escrow processes.

6. **Database Migrations**
   - Create and manage the `freelancer_invoices` table and other necessary database schemas.
   - Ensure data integrity and consistency across the payment and escrow workflows.

## Acceptance Criteria

1. **Repository Binding**
   - The correct Builderforce.ai repository is bound and verified.
   - All necessary files and directories for payments and escrow are present.

2. **API Worker Functionality**
   - Payment intent endpoints are operational and handling transactions correctly.
   - Webhook handlers are processing payment updates and notifications as expected.

3. **Frontend Components**
   - Checkout UI components are fully integrated and functional.
   - Invoice generation and display features are working correctly.
   - CartContext is managing transaction states effectively.

4. **Stripe Connect Integration**
   - Stripe Connect is configured and managing platform and user accounts.
   - Payment processing and transaction handling are secure and compliant.

5. **Escrow Management**
   - Escrow services are holding funds until services are completed.
   - Interfaces for releasing funds and resolving disputes are operational.
   - Chat-channel extensions are integrated for communication during escrow processes.

6. **Database Migrations**
   - The `freelancer_invoices` table and other necessary database schemas are created and managed.
   - Data integrity and consistency are maintained across payment and escrow workflows.

## Out of Scope

- **Custom Payment Gateway Integration**: Any payment gateway other than Stripe Connect.
- **Advanced Financial Reporting Tools**: Detailed financial analytics and reporting features.
- **Multi-Currency Support**: Handling transactions in multiple currencies beyond the initial implementation.
- **Automated Refunds and Dispute Resolution**: Automated handling of refunds and disputes.

## Requirements

_Analysis completed by business-analyst (task #1226)_

### Repository Status

**VERIFIED: seanhogg/builderforce.ai IS the correct repository.**

The bound repository contains all foundational payment infrastructure:

| Component | Location | Status |
|-----------|----------|--------|
| Stripe Integration | `api/src/infrastructure/payment/StripeProvider.ts` | ✅ Present |
| Payment Provider Interface | `api/src/infrastructure/payment/PaymentProvider.ts` | ✅ Present |
| Freelancer Invoices Schema | `api/src/infrastructure/database/schema/billing.ts` | ✅ Present |
| Cart Context | `frontend/src/lib/CartContext.tsx` | ✅ Present |
| Shopping Cart UI | `frontend/src/components/ShoppingCart.tsx` | ✅ Present |
| Marketplace Routes | `api/src/presentation/routes/marketplaceRoutes.ts` | ✅ Present |
| Checkout Flow | `api/src/presentation/routes/tenantRoutes.ts` | ✅ Present |
| Webhook Handlers | `api/src/presentation/routes/webhookRoutes.ts` | ✅ Present |

### Gap Analysis: What Remains to Implement

The PRD claims the repository lacks payment infrastructure — **this is incorrect**. The actual gaps are:

1. **Escrow Functionality** (P0 per ROADMAP.md)
   - No escrow model for holding funds during fixed-price contracts
   - No milestone/escrow state machine
   - ROADMAP explicitly notes: "Fixed-price contracts + milestones + escrow (P0)"

2. **Stripe Connect for Freelancer Payouts**
   - Current Stripe integration handles platform subscriptions (Pro/Teams)
   - Missing: Stripe Connect for paying freelancers
   - Need: Platform account connected to freelancer accounts

3. **Milestone/Fixed-Price Contract Support**
   - ROADMAP: "Only hourly exists; `job_postings` has no `job_type` (hourly|fixed)"
   - Need: Job type enum + milestone table + escrow states

### Implementation Requirements

To satisfy the PRD acceptance criteria, the following must be implemented:

1. **Escrow Data Model**
   - Add `escrow_accounts` table (freelancer engagement + held amount + status)
   - Add `escrow_milestones` table (engagement_id + amount + release conditions + status)
   - Status flow: `funded` → `held` → `released` (or `disputed`)

2. **Stripe Connect Integration**
   - Register platform as Stripe Connect provider
   - Onboard freelancer accounts (Standard/Express)
   - Implement `createEscrowPayment` / `releaseEscrowPayment` / `disputeEscrow` endpoints

3. **API Endpoints**
   - `POST /api/engagements/:id/escrow/fund` — fund escrow from client
   - `POST /api/engagements/:id/escrow/release` — release to freelancer
   - `POST /api/engagements/:id/escrow/dispute` — initiate dispute
   - Webhook handlers for Stripe Connect events

4. **Frontend Components**
   - Escrow status display in engagement details
   - Milestone progress UI
   - Fund/release/dispute actions

5. **Database Migration**
   - Migration for escrow tables (priority: after 0285)

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._