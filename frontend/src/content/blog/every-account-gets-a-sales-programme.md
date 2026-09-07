---
title: Every account gets a sales programme
date: 2026-09-07
description: The pipeline, the campaigns, the weekly numbers, the payouts and the referral link were already built — and only Builderforce's own associates could open them. Now every account owns one, and Reach is where it lives.
tags: [sales, crm, reach, navigation, idea-to-real]
author: Sean Hogg
---

# Every account gets a sales programme

You can take an idea onto a canvas, argue it into objects, build the thing, run it as a company and read whether it worked. Then somebody has to buy it.

Until this week the left rail had an honest answer to that for exactly one kind of account. **Sales Hub** — pipeline, campaigns, weekly targets, reports, payouts, the sales kit — was a row you only saw if you had signed up as a Builderforce sales associate. Everybody else, including every founder who had just shipped something on the platform, got a rail that went *Idea · Make · Run · Measure* and then handed them a marketplace listing and wished them luck.

That is not a missing feature. It is a built feature behind the wrong door.

## What was actually gating it

One line. The service that answers *whose sales workspace is this* asked for an account type before it would hand a person their own:

```
if (requested === current.id) return current.accountType === 'sales' ? { … } : null;
```

Every row the hub touches — contacts, campaigns, goals, referrals, commission rules — is already keyed by `ownerUserId`. Nothing was ever shared between accounts. The check was not protecting anybody's data; it was deciding who was allowed to have a pipeline of their own. So opening it up was the removal of a gate, not the widening of a scope, and the cross-account read stayed exactly as narrow as it was: a superadmin can still only open the workspace of a platform associate, never a customer's private pipeline.

```bf-figure
{
  "kind": "compare",
  "title": "The same hub, two populations",
  "columns": [
    { "title": "Before", "hue": "muted", "items": [
      "Sales associates selling Builderforce itself",
      "A superadmin, reading an associate's numbers",
      "Everyone else: no row, no pipeline, no referral link"
    ] },
    { "title": "Now", "hue": "reach", "items": [
      "Every account, on its own workspace",
      "A superadmin, reading an associate's numbers — unchanged",
      "One hub, one definition of conversion rate, one report"
    ] }
  ],
  "caption": "A second hub for founders would have been a second definition of \"won\" waiting to disagree with the first."
}
```

## What you get, the first time you open it

Six sub-views, all of them already load-bearing because associates have been running the business on them:

```bf-figure
{
  "kind": "stack",
  "title": "Sales Hub",
  "bands": [
    { "label": "Overview", "note": "Weekly targets against what actually happened — outreach, contacts, meetings.", "hue": "reach" },
    { "label": "Leads", "note": "The pipeline. Seven stages, a deal value, a probability, an expected close date.", "hue": "reach" },
    { "label": "Reports", "note": "Signups, conversions, converted revenue, earned commission — one report, whoever is reading it.", "hue": "measure" },
    { "label": "Payouts", "note": "Earned from the sales domain, paid from the ledger, available is the arithmetic between them.", "hue": "run" },
    { "label": "Inbox", "note": "The connected mailbox, beside the pipeline it is working.", "hue": "reach" },
    { "label": "Kit", "note": "The collateral, and the referral link that attributes a signup to you.", "hue": "reach" }
  ],
  "caption": "Nothing here is new code. It is the same hub that ran Builderforce's own associate programme, now owned by the person looking at it."
}
```

The commercial *objects* — quotes that can be accepted, sequences that stop on a reply, trials with criteria agreed up front, mutual action plans — have lived on the canvas since August, and they still do. This is the other half of the same argument: the canvas is where you work a specific deal, and the hub is where you read the shape of all of them at once.

## Where it sits in the method

Reach. And Reach is now one stage shorter to say.

```bf-figure
{
  "kind": "screen",
  "frame": "The left rail",
  "ratio": 1.05,
  "regions": [
    { "label": "Idea", "note": "Canvas", "x": 4, "y": 8, "w": 92, "h": 12, "hue": "idea" },
    { "label": "Make", "note": "Projects, Workforce, Quality, Reliability, Knowledge", "x": 4, "y": 22, "w": 92, "h": 12, "hue": "make" },
    { "label": "Run", "note": "The nine business seats", "x": 4, "y": 36, "w": 92, "h": 12, "hue": "run" },
    { "label": "Measure", "note": "Insights", "x": 4, "y": 50, "w": 92, "h": 12, "hue": "measure" },
    { "label": "Reach", "note": "Marketplace · Developers · Sales Hub", "x": 4, "y": 64, "w": 92, "h": 16, "hue": "reach" },
    { "label": "Expand", "note": "Removed — one heading over one row", "x": 4, "y": 82, "w": 92, "h": 10, "hue": "muted", "style": "ghost" }
  ],
  "caption": "A heading with a single link under it is a label, not an information architecture."
}
```

The rail used to carry a sixth productive stage called **Expand**, and its entire content was the sales programme. The distinction it drew was real enough on paper — *Reach* is putting the thing in front of people, *Expand* is growing the business off the back of it — and it cost a person one more word to read before they could find anything.

It is also a distinction that stops being true the moment a founder rather than an associate is standing in front of it. Selling what you made and being found for it are the same act at different volumes. So Reach absorbed it, the arc's question got a little longer — *sell it, be found, grow it* — and the whole method is five words again, which is the number a person can repeat back after reading the rail once.

That is the test this navigation has always been held to. The menu is the methodology; if you cannot say the methodology, the menu has stopped working.

## The dogfooding argument, stated plainly

Builderforce sells a sales programme to its own associates. It would be a strange product that sold one and did not give one to the people building companies on it — and a stranger one that shipped a CRM, ran its own revenue through it for months, and then asked its customers to go and buy a different one.

Every capability on this platform is one the founder using it will eventually need. This one they need on the day the thing they built works.
