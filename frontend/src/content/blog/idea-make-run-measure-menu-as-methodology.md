---
title: Idea · Make · Run · Measure — when a menu becomes a methodology
date: 2026-08-12
description: Most product navigation is an org chart. Builderforce groups every destination by where it sits in the journey instead, generates the marketing site from the same list, and lets a build script prove the two can never disagree.
tags: [methodology, navigation, product-design, idea-to-real]
author: Sean Hogg
---

# Idea · Make · Run · Measure — when a menu becomes a methodology

Open almost any business platform and the left-hand menu is an org chart. Sales. Marketing. Finance. Engineering. HR. It is a perfectly reasonable list, and it answers a question only an existing company can ask: *whose department is this?*

Somebody arriving with an idea cannot answer that question. They do not have departments. They have a thing they want to make and no idea what happens next.

So Builderforce groups its destinations by **where you are in the journey** instead.

```bf-figure
{
  "kind": "stack",
  "title": "Every destination sits in exactly one of these",
  "bands": [
    { "label": "Idea", "note": "What if? — Canvas. One row, because at this stage there is one thing to do.", "hue": "idea", "tag": "public" },
    { "label": "Make", "note": "Build it. — Projects, Workforce, Quality, Reliability, Knowledge, Embedded.", "hue": "make" },
    { "label": "Run", "note": "Run it as a company. — Finance, Revenue, People, Hiring, Investor, Governance, Support, Growth, Inbox.", "hue": "run" },
    { "label": "Measure", "note": "Is it working? — Insights: delivery, autonomy, finance, DevEx, compliance, alerts.", "hue": "measure" },
    { "label": "Market", "note": "Sell, buy, hire, be found. — the Marketplace, a second front door.", "hue": "market", "tag": "public" },
    { "label": "Expand", "note": "Grow it. — the referral and sales-associate programme.", "hue": "expand" }
  ],
  "caption": "Admin is the seventh and is deliberately dull. Nobody browses a product's settings before signing up."
}
```

The order is the argument. Read it top to bottom and it is a sentence about how a business comes to exist.

## What this replaced, and why it was not just untidy

This is worth being specific about, because "we reorganised the navigation" is the least interesting sentence in software and this was not that.

There were **four** separate lists declaring navigable destinations. One for the signed-in rail. One for the marketing pages. One for the data model's domains. One for the footer. The CFO existed four times, under four names — and one of those four navigated a signed-in customer *out of the product* into a marketing page describing the thing they were already using.

That is not an aesthetic problem. It is a person losing their session to read a brochure about their own workspace.

```bf-figure
{
  "kind": "compare",
  "title": "Four lists, or one",
  "columns": [
    {
      "title": "Four registries",
      "hue": "bad",
      "items": [
        "The rail said \"Finance\"; the menu said \"Business Intelligence\".",
        "Whole destinations had no marketing row at all, so the menu advertised a smaller product than shipped.",
        "The footer listed an id nothing declared and rendered a short column silently.",
        "Every fix had to be made in four places, and the fourth was always found later."
      ]
    },
    {
      "title": "One registry, projected",
      "hue": "good",
      "items": [
        "The rail, the menus, the footer and /features all read the same array.",
        "A capability the product does not have cannot appear on the marketing site.",
        "A stage's question has one home, rendered identically everywhere it appears.",
        "A build script fails if a second list appears. The rule is enforced, not remembered."
      ]
    }
  ]
}
```

The last line is the one that makes it stick. There is a check in the test suite that walks every source file looking for an object carrying both a route-ish field and a label-ish field — a destination by any other name — and fails the build if it finds one outside the registry. Exemptions exist, and each one has to carry a written sentence explaining why a registry row could not reach that case.

A *count* would let debt sit there looking like progress. A *list of reasons* makes the next author say out loud why their exception is one.

## The marketing site is a projection

Here is the part that matters most for anyone reading the site rather than using the product: **`/features` is generated from that same registry.**

The stage table, the destination chips, the counts in the overview card — all computed. Which means the page cannot advertise a destination that does not exist, and cannot miss one that does. A marketing number that drifts from the product is the cheapest kind of lie to ship and by far the most expensive to notice.

```bf-figure
{
  "kind": "flow",
  "title": "One declaration, four consumers",
  "steps": [
    { "label": "The registry", "note": "One array. Each row carries its owner (which seat), its stage (where in the arc), and the rung at which it activates.", "hue": "make" },
    { "label": "The left panel", "note": "Groups by stage. Rows above your rung are dimmed, never hidden — a dim row is an invitation, a missing row is a secret.", "hue": "run" },
    { "label": "The public menus", "note": "Product ▾ shows Idea · Make · Run · Measure. Learn ▾ shows Read · Prove · Build with.", "hue": "read" },
    { "label": "/features", "note": "The same rows again as a table, with the question each stage answers and a link per destination.", "hue": "measure" }
  ],
  "caption": "The Learn menu's three columns are the method's own three acts wearing a second hat — reading, proving, building with. That rhyme is not decoration; it is the same posture applied to learning about the product rather than making something with it."
}
```

## Progressive disclosure, and why nothing is hidden

A row is **always listed**. What the journey gates is its *state*, not its existence.

Somebody with no account sees all of it: the CFO, the Recruiter, the governance surface, the whole roster — dimmed, with one honest line and a single setup button that routes to whoever owns the thing they would need first. The CFO's button hands you to the CEO, because the CEO owns company formation and the CFO cannot exist before a company does.

The reasoning is one sentence: **nobody asks for a capability they have never seen.** Hiding the business surfaces until somebody "qualifies" turns a ramp into a locked door, and the person on the wrong side of it never learns what was behind it.

And climbing all the way is not required. Stopping partway is a complete, successful use of the product. Someone who ships three landing pages and never forms a company has not failed to onboard — they got what they came for.

## The one thing a stage cannot be

A stage is not a department, and the temptation to make it one is constant. The clearest test the team applies: **is this a phase of work, or a group of people?**

"AI" failed that test, which is why there is no AI section. Its destinations went to the seats that own the work — expense categorisation to Finance, contract analysis to Governance, competitor monitoring to Growth, pitch-deck feedback to the CEO. A menu item named after a technology tells you what the software is made of. The seats tell you what it is for.

Same test, same answer, for "Reports", "Automation" and "Integrations". Each is a property of many destinations, not a place.

---

*See the whole arc generated live on [the features page](/features), or skip the tour and [start at Idea](/create/new). The method the stages carry is written up in [Idea to Real](/blog/idea-to-real-the-operating-methodology).*
