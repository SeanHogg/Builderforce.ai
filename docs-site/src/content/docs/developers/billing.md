---
summary: "Charge for a Builderforce.ai extension: plans, metered usage on the customer's existing invoice, the revenue share, and how a publishing workspace is paid out"
read_when:
  - Setting a price on a published extension
  - Deciding between a flat plan and usage-based pricing
  - Working out what the revenue share is and when it starts
  - Withdrawing what a workspace has earned
title: "Selling an extension"
---

# Selling an extension

The customer **never creates an account with you and never enters a second card**.
They pick a plan on your listing, and the charge lands on the Builderforce.ai
invoice they already receive. You are paid through the same payouts every seller
on the platform uses.

Every extra signup and every extra credit card is a conversion cliff. Removing
both is the single most valuable thing this marketplace does for you.

## Before you can charge

Your workspace must be **`identity_verified`**. The check is enforced in three
places — when you set a price, when a version is reviewed, and at the moment money
would actually move — so there is no order of operations that gets around it.

Until then the pricing form is visible and disabled, with the reason on it.

## Plans

A package's plans are a price list on its listing. Set them at `/developers` →
**Publish** → select your package → *Pricing*, or with
`PUT /api/developer/packages/{id}/plans`.

| Field | Meaning |
|---|---|
| `code` | Stable, lowercase. What an install stores and a checkout names. |
| `name` | What the customer sees. |
| `priceCents` | The recurring charge. May be `0`. |
| `interval` | `month` or `year`. |
| `includedUnits` | Units the recurring price already covers. |
| `meteredRateCents` | What one unit beyond the allowance costs. May be `0`. |
| `unitLabel` | Your word for one unit. **It appears on the customer's invoice.** |

`priceCents` and `meteredRateCents` may each be zero, but not both — a plan that
charges nothing either way is the free listing your package already is.

Three shapes are therefore expressible:

* **Flat** — `priceCents: 4900`, no metering. A subscription and nothing else.
* **Flat + overage** — `priceCents: 900`, `includedUnits: 1000`,
  `meteredRateCents: 2`. The allowance is per period and does not roll over.
* **Pure usage** — `priceCents: 0`, `meteredRateCents: 2`. Nothing is charged at
  install, so there is no checkout page: the customer's workspace must already
  have a validated card, and we say so rather than sending them to a $0.00 page.

Set `unitLabel` to something a person recognises. An invoice line reading
"1,412 units" is one your customer has to ring somebody about; "1,412 documents"
is one they understand.

## Editing a price list

The whole list is replaced at once, and **existing customers are never moved**.
If you remove a plan somebody is on, their install keeps naming it and we stop
metering rather than guessing a new price. Rewriting what a customer agreed to pay
is the one thing a marketplace must never do quietly.

Submitting an empty list makes the package free again and takes the listing off
sale. Past orders keep pointing at the listing they named.

## Metered usage

You report units; we price them, put one line on the customer's next invoice, and
credit you. See [the vendor API](./vendor-api#reporting-usage) for the call.

* A period is **30 days**, opening when the install does.
* `usageId` is **your** id for the occurrence and is the idempotency key. Retry
  freely: a duplicate returns `recorded: false` and a 200, which is our word that
  the occurrence is already counted exactly once.
* Report as it happens or in batches. `occurredAt` is honoured inside the open
  period and clamped to it — you may say *when*, not *which invoice*.
* Cancelling closes the open period first, so usage already consumed is still
  billed.

The customer can see the running total and the individual reports behind it before
the invoice arrives. So can you, on the same call.

## The revenue share

**0% until $200,000 in lifetime earnings. 15% above it.**

The threshold is lifetime and per publishing workspace, and the rate is stamped
onto each sale at the moment it is made — so the sale that carries you over the
threshold never re-prices the ones before it. In year one the scarce resource is
listings, not margin.

The live figures, and which side of the threshold you are on, are on the
**Earnings** tab. They are read from the same schedule the charge path reads, so
what you are shown is what you are charged.

## Getting paid

Earnings accrue to the **workspace**, not to a person — an extension names no
author, and money that followed whoever happened to hold the owner role would
follow them out of the company.

1. Connect a payout destination in the workspace.
2. Nominate it on **Earnings** → *Payout destination*.
3. Withdraw. The amount is the available balance we compute; there is nothing to
   send, because an endpoint that accepted an amount would pay whatever was asked
   for.

You are credited when a period closes or a subscription is paid, not when the
customer's card clears. We are the merchant of record, so the collection risk is
ours — you should not be carrying a credit risk you cannot see or price.

## Failed payments

A failed renewal puts the install in `past_due`, and **the extension keeps
working**. Switching somebody's payroll integration off the hour their card
expired loses everybody the customer. What ends the relationship is a
cancellation, which is a decision somebody makes — and at that point tokens stop
minting and usage is refused.
