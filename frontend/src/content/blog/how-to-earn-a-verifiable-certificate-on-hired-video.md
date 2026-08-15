---
title: How to Earn a Verifiable Certificate on Builderforce (and Prove It's Real)
date: 2026-05-27
description: Complete a course or learning path on Builderforce to earn an HMAC-signed certificate anyone can verify — plus how to share it so an employer can confirm it's genuine.
tags: [learning, training, courses, hmac-certificate, prove-certification, learning-certificate]
author: Sean Hogg
---

# How to Earn a Verifiable Certificate on Builderforce (and Prove It's Real)

## Why 'Verifiable' Is the Word That Matters

Anyone can make a certificate in a word processor. The problem isn't producing one — it's getting an employer to believe it. A verifiable certificate solves exactly that: it carries a cryptographic signature so a third party can confirm it was genuinely issued, for you, for that specific course, and hasn't been altered.

Builderforce signs every certificate with an HMAC. That's what separates a credential a hiring manager will trust from a PDF anyone could fake.

## Step 1: Complete the Required Path

Enroll in a [course](/training) or learning path and finish what it requires. Completion isn't a self-checkbox — your progress is recorded to the platform's xAPI Learning Record Store as you go, including SCORM lesson results and learning-path nodes.

If the path has prerequisites, earlier modules unlock later ones, so you complete them in order. When the LRS has recorded that you've met the requirements, you're eligible for the certificate.

## Step 2: Receive the Signed Certificate

On completion, Builderforce issues your certificate signed with an HMAC. The signature is bound to your identity and the specific course — change a single character of the certificate's content and the signature no longer matches.

Earning it also feeds gamification: completing learning awards points and can unlock badges, so the credential is one of several rewards for finishing.

## Step 3: Share It So an Employer Can Verify

When you share the certificate, the recipient can run it through verification: the verifier recomputes the signature over the certificate's contents and confirms it matches what Builderforce issued. A genuine certificate passes; a tampered or fabricated one fails.

That's the whole point. You don't ask the employer to take your word for it — you hand them something they can independently check in seconds. Link it on your profile, attach it to an application, or send it directly to a hiring manager.

## Frequently Asked Questions

### What makes the certificate 'verifiable' rather than just a PDF?

It's signed with an HMAC. A verifier recomputes the signature over the certificate's contents and checks it against what Builderforce issued. If anything was altered — the name, the course, the date — the signature won't match, so tampering is detectable.

### How does the platform know I actually completed the course?

Your progress is recorded to an xAPI Learning Record Store as you work through lessons, SCORM packages, and learning-path nodes. The certificate is issued against those records, not a self-reported checkbox.

### Can I put the certificate on my profile?

Yes. You can surface it on your profile, attach it to applications, or send the verifiable link directly to an employer who can confirm its authenticity independently.

---

**Try it:** [Courses](/training) on Builderforce.
