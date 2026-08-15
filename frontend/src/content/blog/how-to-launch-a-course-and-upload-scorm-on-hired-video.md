---
title: How to Launch a Course (and Upload SCORM) on Builderforce
date: 2026-05-10
description: Publish a course on Builderforce as a Creator or employer — structure modules, upload SCORM 1.2 packages, track completion with the built-in xAPI LRS, and issue verifiable certificates.
tags: [learning, training, courses, xapi-lrs, upload-scorm, sell-a-course]
author: Sean Hogg
---

# How to Launch a Course (and Upload SCORM) on Builderforce

## Who Can Author a Course

Course authoring on Builderforce is open to Creators and employers — the same eligibility check (`resolveAuthorEligibility`) gates both course and classroom authoring. Students are job seekers in a learning mode; you don't need a separate "instructor" account to publish.

A course is the right surface when you have structured, self-paced material: an onboarding curriculum, a certification prep track, or a skills course you sell. If you'd rather run a live, cohort-based class with assignments, see the classroom guide — they share infrastructure but solve different jobs.

## Step 1: Create the Course and Add Modules

From the Creator dashboard open [Courses](/training) and create a new course. Give it a title, description, and the audience it's for. Then add modules — each module is a unit of the curriculum, and modules hold lessons.

Structure the path before you fill it. A learner should be able to read your module list and understand the arc: foundations, then application, then assessment. Order matters because learning paths support prerequisites — later modules can require earlier ones.

## Step 2: Upload a SCORM 1.2 Package

If you've authored content in a tool like Articulate Storyline, iSpring, or Adobe Captivate, export it as a SCORM 1.2 package (a .zip) and upload it as a lesson. Builderforce runs a built-in SCORM 1.2 runtime, so the package's completion, score, and bookmarking calls are captured natively — no third-party LMS needed.

SCORM is the right choice when your content is interactive (branching scenarios, embedded quizzes, drag-and-drop). For straightforward video or text lessons, you don't need SCORM at all — author them directly as lessons.

## Step 3: Track Completion with the xAPI LRS

Beyond SCORM, Builderforce includes an xAPI Learning Record Store. Statements ("learner X completed activity Y") are recorded to the LRS, giving you a durable, queryable record of who did what — across SCORM packages, native lessons, and learning-path nodes.

This is what lets completion mean something. When a learner finishes the required path, the LRS has the evidence, which is the foundation for issuing a certificate that a third party can actually trust.

## Step 4: Issue a Verifiable Certificate

On completion, Builderforce can issue a certificate signed with an HMAC so its authenticity can be verified later. A holder shares the certificate; a verifier checks the signature and confirms it was genuinely issued for that learner and that course — it can't be forged by editing a PDF.

Certificates plug into gamification too: completing learning awards points and can unlock badges, which keeps learners moving through the path. Publish the course, set its price (or make it free), and learners enroll, progress, and earn a credential that holds up to scrutiny.

## Frequently Asked Questions

### Do I need an external LMS to host SCORM?

No. Builderforce has a built-in SCORM 1.2 runtime, so you upload your SCORM .zip as a lesson and the platform captures completion, score, and bookmarking directly. There's also an xAPI LRS for statement-level tracking across all lesson types.

### Are the certificates actually verifiable?

Yes. Certificates are signed with an HMAC, so a verifier can confirm the certificate was genuinely issued for a specific learner and course. That makes it tamper-evident — unlike a plain PDF, it can't be forged by editing the text.

### Can employers author courses too, or only Creators?

Both. Course and classroom authoring share one eligibility check, so Creators and employers can both publish. This is what lets a company stand up an onboarding or compliance curriculum on the same surface a Creator uses to sell a skills course.

---

**Try it:** [Courses](/training) on Builderforce.
