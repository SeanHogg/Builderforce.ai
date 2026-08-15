---
title: How to Use the Employer Research Tool: Reviews and Salary Data in 10 Minutes
date: 2026-05-25
description: A walkthrough of Builderforce's Employer Research tool — combine multi-axis company reviews with role × city salary data to pressure-test an offer before you accept, or to negotiate the one you have.
tags: [job-search, career-strategy, employer-research, salary-by-city, company-reviews, employee-reviews]
author: Sean Hogg
---

# How to Use the Employer Research Tool: Reviews and Salary Data in 10 Minutes

## Open the Tool and Run a 10-Minute Pre-Offer Audit

Open the [Employer Research tool](/tools/employer-research) and you'll see three inputs: **Company**, **Role**, and **City**. Fill any combination and hit Run Research — the tool runs the company-reviews lookup and the role × city salary fetch in parallel and renders both panels side by side.

Most candidates skip this step and find out about the bad parts of the company in week three. The tool exists so you don't have to flip between three tabs to do the same audit.

**Minutes 1–3 — Reviews.** Type the company name. The Companies panel returns up to 6 matches with their overall rating + review count. Click *Reviews* on any match to jump to the full reviews page (`/companies/{slug}/reviews`) and read the six sub-axis ratings: culture, leadership, work-life balance, compensation, career growth, diversity. If any single axis is more than 1.0 below the overall average, that's where you should ask follow-up questions in your final round.

**Minutes 4–6 — Salary by role × city.** Type your target role and city. The Salary panel shows the average, min, and max salary derived from real active listings on the platform — not self-reported levels.fyi data. Click *Open full salary guide* to see related cities and related roles at `/salary/{role}/{city}`.

**Minutes 7–10 — Cross-reference.** On the full reviews page, search the written reviews for the keyword *compensation* or *pay*. A high compensation rating combined with a market-aligned offer from the salary panel is the green light. A low compensation rating combined with a below-market offer is a hard signal to negotiate or walk away.

## What the Six Sub-Axis Ratings Actually Mean

Glassdoor uses a single overall score. Builderforce splits the rating across six axes because employees rarely give a uniform answer:

- **Culture** — day-to-day team dynamics, psychological safety, social tone
- **Leadership** — competence and consistency of managers and execs
- **Work-Life Balance** — actual hours expected, weekend / on-call norms
- **Compensation** — market-relative pay and bonus structure
- **Career Growth** — promotion velocity, mentorship, lateral mobility
- **Diversity & Inclusion** — representation and equity in practice

For a 4.0 overall, the *shape* matters more than the number. A 4.0 made of (5, 5, 2, 5, 5, 2) is very different from (4, 4, 4, 4, 4, 4). The first is great culture with brutal hours and a homogeneous team; the second is a steady, balanced employer.

When you read reviews, sort by Most Recent — companies change faster than annual averages reflect.

## Salary Guides: Why the Numbers Are Different from Glassdoor

Builderforce's salary guides derive from **active job listings** on the platform, not from anonymous self-reporting. This has three practical implications:

1. **The numbers are forward-looking.** A self-reported salary from 2023 doesn't tell you what a company will pay in 2026. A live listing posted last week does.

2. **The sample size is transparent.** Every salary page shows the number of listings the figure is based on. If a role × city page says "Based on 6 listings," treat the number as directional. "Based on 142 listings" is a real signal.

3. **The city dimension matters.** `/salary/staff-product-manager/austin` is a completely different number from `/salary/staff-product-manager/san-francisco` even for the same company tier — and the comp benchmark you should negotiate against is the city-level one, not the national average.

Use the related-cities and related-roles links at the bottom of each salary page to pivot quickly: "What does this same role pay in Seattle?" or "What does a Staff Engineer make in this city versus a Principal?"

## Three Negotiation Plays You Can Run Today

Once the tool has populated both panels, you have enough to run any of these:

**Play 1 — The Market Citation.** When the salary panel shows your offer is below the city-level average for your role, reply with: "Thanks for the offer. Based on active listings for this role in {city}, the average is {fmt(avg)}. I'd like to anchor the conversation around that number." Cite the `/salary/{role}/{city}` URL from the *Open full salary guide* button. This shifts the burden from "why I want more" to "why your offer is below market."

**Play 2 — The Reviews Pivot.** When the comp axis on the company-reviews page is below 3.5, accept that compensation isn't the company's strength — and negotiate hard for what *is*. If the career growth axis is 4.7, push for promotion-track clarity and a 6-month review with a defined raise. If work-life balance is 4.5, push for an explicit remote-work guarantee.

**Play 3 — The Stale Offer Refresh.** If your offer is 2+ weeks old and the salary panel now shows a higher market rate, write: "Since we last spoke, I've reviewed current pay bands for similar roles in {city}. I'd like to revisit the offer to align with the {percentile} percentile." This is most effective in cities where salary guides have updated within the offer-pending window.

All three plays work better when the company knows you've done the homework. Pasting a Builderforce URL from the tool signals you're using a public benchmark, not an aspirational anchor.

## When to Trust Reviews and When to Discount Them

Trust the signal more when:
- The review count is **10+** and the published rating average is stable across recent reviews
- Sub-axis ratings are **internally consistent** with the written pros / cons / advice
- Reviews come from **multiple job titles** at the company, not just one team

Discount the signal when:
- The review count is **under 5** (any single bad review skews the average)
- The same complaint recurs in **exactly the same words** (often a coordinated post-layoff dump)
- Reviews are all from **one job title** (probably one team's bad experience, not the whole company)

When reviews and salary data disagree — high reviews but below-market pay — the most common explanation is a company that pays in equity. Ask explicitly in the interview about the equity grant size and the vesting cliff.

## Frequently Asked Questions

### Are Builderforce company reviews verified?

Reviews are bound to authenticated user accounts (one review per user per company), and reviewers can earn a verified-employee badge by matching their corporate email domain at review time. Sub-axis ratings are stored as numeric columns so the platform can audit aggregate drift and flag suspicious bursts.

### Where does the salary data come from?

From the `salaryMin` / `salaryMax` fields on active job listings posted on Builderforce. The numbers are forward-looking (what companies are paying today) rather than self-reported (what people made years ago). Every salary page shows the underlying sample size.

### What's the difference between /salary/:role and /salary/:role/:city?

`/salary/:role` aggregates across every city in the US, useful for a national benchmark. `/salary/:role/:city` filters to one city — the number you should actually negotiate against, because compensation varies 20–40% across major tech hubs.

---

**Try it:** [Employer Research](/tools/employer-research) on Builderforce.
