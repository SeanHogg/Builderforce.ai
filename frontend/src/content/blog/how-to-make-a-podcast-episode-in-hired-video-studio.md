---
title: How to Make a Podcast Episode in the Builderforce Creation Canvas (Step-by-Step)
date: 2026-05-08
description: Record, script, and publish a podcast-style audio episode in the Builderforce Creation Canvas — using the teleprompter, AI voiceover, and multi-track audio editing without leaving the browser.
tags: [creation-canvas, video-resume, studio, audio-resume, podcast-resume, ai-voiceover-podcast]
author: Sean Hogg
---

# How to Make a Podcast Episode in the Builderforce Creation Canvas (Step-by-Step)

## What the Podcast Media Kind Is For

the Builderforce Creation Canvas is no longer video-only. The studio document carries a `mediaKind` — video, podcast, voice, or animation — and the podcast kind switches the editor into an audio-first layout: waveform tracks instead of a visual canvas, chapter markers instead of scenes, and an export that produces a clean MP3 rather than an MP4.

A podcast episode is the right format when your message is better heard than watched: a career-story episode for your profile, a subject-matter explainer that demonstrates expertise, or an interview you host as a Creator. Because the same document model backs every media kind, you can start from a video script and convert it to a podcast without re-typing a word.

## Step 1: Open Studio and Choose the Podcast Kind

Open [Studio](/creation-canvas) and create a new document. In the new-document picker, choose **Podcast**. The editor loads the audio layout: a transport bar, one or more audio tracks, and a script pane on the left.

If you already have a video draft you'd rather narrate as audio, open it and switch its media kind from the document settings — the script and chapter structure carry over, and the visual layers are simply hidden from the audio export.

## Step 2: Write or Paste Your Script

Type your episode into the script pane, broken into chapters. Each chapter becomes a marker on the timeline so listeners (and you, while editing) can jump between segments.

Keep chapters short — 60 to 120 seconds of spoken audio each. A 10-minute episode is roughly 1,300–1,500 spoken words. The teleprompter reads from this pane while you record, so write the way you talk: short sentences, one idea per line.

## Step 3: Record, or Generate AI Voiceover

You have two ways to get audio onto the track:

**Record yourself.** Click record, read from the teleprompter, and Studio captures a track in the browser. Re-record any chapter individually without touching the rest — the chapter markers make it a clean swap.

**Generate AI voiceover.** If you're audio-shy or want a consistent narrator, select a chapter and generate text-to-speech from the script. This is the same TTS engine used for video voiceover; it runs against your script text so updates stay in sync.

Most creators mix both: AI voiceover for intros, outros, and ad-style segments; their own voice for the parts that need authenticity.

## Step 4: Edit, Add a Second Track, and Export

Trim silences and stumbles directly on the waveform. Add a second track for intro music or a bed under your narration, and set its level so it sits behind your voice. Studio renders the mix in the browser using the same ffmpeg.wasm pipeline as video export — no server round-trip, no upload of your raw audio.

When you're happy, export to MP3. Publish it to your profile as an audio resume, attach it to a Creator post, or download it for an external podcast host. The whole loop — script to published episode — happens in one tab.

## Frequently Asked Questions

### Do I need to download any software to record a podcast?

No. Studio records, edits, and exports entirely in the browser. Recording uses your device microphone via the browser, and the final mix is rendered client-side with ffmpeg.wasm, so your raw audio never has to be uploaded to render an episode.

### Can I convert an existing video draft into a podcast?

Yes. Because every Studio document shares one underlying model with a mediaKind axis, you can switch a video document to the podcast kind. The script and chapter structure carry over; the visual layers are simply excluded from the audio-only export.

### Is AI voiceover required?

No — it's optional. You can record entirely in your own voice, generate every chapter with AI voiceover, or mix the two. The teleprompter works either way so you stay on script while recording.

---

**Try it:** [Studio](/creation-canvas) on Builderforce.
