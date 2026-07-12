> **PRD** — drafted by Ada (Sr. Product Mgr) · task #373
> _Each agent that updates this PRD signs its change below._

# Freelancer earnings dashboard & payout history

## Problem & Goal

* The current Freelancer Earnings dashboard (`FreelancerStats`) is lacking, not providing a comprehensive overview of a freelancer's earning history, pending issues, and withdrawal requests.
* The goal is to create a reusable, extensible, and flexible Product that meets the needs of Upwork freelancers.

## Target users / ICP roles (if relevant)

* Freelancers (ICP Role)

## Scope

* The Product will consist of the following endpoints:
	+ `/api/freelancers/:freelancerId/earnings` - Current balance and pending vs. paid status
	+ `/api/freelancers/:freelancerId/earnings-history` - Detailed payout history
	+ `/api/freelancers/:freelancerId/withdrawal-requests` - Withdrawal requests
* The Product will be able to display information on a viewer's earnings, pending issues, and complete payout history.

## Functional requirements

1. **Current Balance** (user can view the current balance of their Upwork earnings).
2. **Pending vs. Paid** (user can filter pending vs. paid earnings).
3. **Payout History** (user can view detailed payout history).
4. **Withdrawal Requests** (user can view their current withdrawal requests).

## Acceptance criteria

* As a [Freelancers] (freelancers), I can view what I've earned, what's pending, and my full payout history.
* The Product will display the current balance, pending vs. paid earnings, and payout history.
* The Product will not display any personal information about the freelancer.

## Out of scope

* Integrating with bank accounts for automatic withdrawal/deposit.
* In-depth fraud analysis for blocked accounts background.
* Linking personal bank account information to saved profile settings. (privacy concerns)
* Smart contract-based payment/withdrawal functions. (requires platform change and legal implications)
* Implementing relationship building and loyalty program features. (not currently relevant and change may come)
* Implementing a loyalty program message board. (not currently relevant and change may come)