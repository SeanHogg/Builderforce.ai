---
title: How to Run a Classroom Cohort as an Educator on Builderforce
date: 2026-05-19
description: Set up a cohort, enroll students, hand out learning assignments, and track classroom analytics on Builderforce — the educator workflow that turns a self-paced course into a live class.
tags: [learning, training, courses, classrooms, run-a-cohort, educator-tools]
author: Sean Hogg
---

# How to Run a Classroom Cohort as an Educator on Builderforce

## Cohorts vs Self-Paced Courses

A self-paced course is a learner alone with the material. A classroom cohort is a *group* moving through material together on a schedule, with an educator handing out assignments and watching progress. Cohorts add accountability and pace — the two things that most improve completion rates.

On Builderforce, an educator is a Creator or employer; a student is a job seeker in learning mode. Neither is a new role — the cohort layer sits on top of the accounts you already have. You'll find your classrooms as a tab on the Tools page at [/tools?tab=classrooms](/training), and students see their side under the learning tab.

## Step 1: Create a Classroom

Open [Classrooms](/training) and create a cohort. Give it a name, a description, and the course or learning path it's built around. The cohort is the container — it holds members and the assignments you'll give them.

Decide the shape up front: a fixed-start cohort where everyone begins together, or a rolling cohort students join as they enroll. Fixed-start cohorts get the strongest peer accountability; rolling cohorts are easier to operate at scale.

## Step 2: Enroll Students

Add members to the cohort. Membership is tracked explicitly, and access throughout the classroom is gated by the same `canActFor` permission seam the rest of the platform uses — so an educator acts on their own cohort and can't reach into someone else's.

Keep cohorts small enough to give attention. The accountability that makes cohorts work depends on the educator actually seeing each student's progress; that breaks down past a certain size, so split a large intake into multiple cohorts rather than one giant room.

## Step 3: Hand Out Learning Assignments

Assignments are the educator's lever. Assign a module, a lesson, or a whole path to the cohort with a due date. Students see the assignment in their learning tab; you see who's completed it.

Assignments are the bridge between content and pace. A self-paced course says "here's the material." An assignment says "finish module 2 by Friday" — and that single change is what moves a cohort through the curriculum together instead of drifting apart.

## Step 4: Watch the Analytics

The classroom surfaces cached cohort analytics — completion rates, who's behind, where students stall. Use it to intervene early: a student who hasn't started by the second due date needs a nudge before they disengage entirely.

Because completion flows through the same xAPI LRS that backs courses, the analytics are grounded in real records, not self-reports. When the cohort finishes, the same certificate machinery that powers self-paced courses issues verifiable credentials to your students.

## Frequently Asked Questions

### Is 'educator' a separate account type?

No. An educator is a Creator or employer, and a student is a job seeker in a learning mode. The cohort layer sits on top of existing accounts — there's no new role to sign up for.

### Where do I find my classrooms?

Classrooms live as a tab on the Tools page at /tools?tab=classrooms, not as a separate sidebar item. Students see their enrolled learning under /tools?tab=learning.

### How is access controlled between cohorts?

Through the platform's canActFor permission check. An educator acts only on their own cohort's members and assignments and can't reach into a cohort they don't own, which keeps student data scoped to the right classroom.

---

**Try it:** [Classrooms](/training) on Builderforce.
