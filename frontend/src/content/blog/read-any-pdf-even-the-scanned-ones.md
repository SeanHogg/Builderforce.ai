---
title: Read any PDF — including the scanned ones nobody can search
date: 2026-08-21
description: Modern PDFs store glyph indices, not letters, which is why so many tools hand back gibberish. Here is what actually goes wrong, and what happens now when you drop a scan, a contract or a résumé on the board.
tags: [documents, pdf, ocr, creation-canvas, resume]
author: Sean Hogg
---

# Read any PDF — including the scanned ones nobody can search

Drop a five-page PDF résumé on a board. Get back a file icon reading **"Text not extractable"** and an assistant politely asking you to copy and paste the text of the document it is holding.

That was a real report, and it is worth explaining properly, because "the tool could not read my PDF" is one of those complaints that sounds like carelessness and is almost always something specific.

## Why a PDF you can read is a PDF a program cannot

A PDF does not store a paragraph. It stores instructions to draw shapes at coordinates. When those shapes are letters, the file usually carries an embedded font — and to keep the file small, most modern exporters **subset** it: they include only the glyphs actually used, renumbered.

So the string in the file is no longer `Hello`. It is a list of glyph indices into a private table, typically written in hexadecimal, that mean "Hello" only in the presence of that specific subset font.

```bf-figure
{
  "kind": "compare",
  "title": "What the bytes in a drawn string actually are",
  "columns": [
    { "title": "A PDF from about 2005", "hue": "muted", "items": ["Text drawn from literal characters", "Naive extraction works", "This is what most simple readers assume"] },
    { "title": "A PDF from Google Docs, Word or Pages", "hue": "make", "items": ["Subset font, glyph indices", "Written in hex, not as letters", "Read literally, it decodes to mojibake", "A legibility check correctly refuses to show it"] }
  ],
  "caption": "The reader was not broken. It was reading a numbering scheme as if it were the alphabet."
}
```

The translation table was in the file the whole time — every such font carries a character map that says which glyph index means which character. Reading it is the fix, and it is why exports from the three word processors people actually use now arrive as text rather than as noise.

## The half with no text at all

```bf-figure
{
  "kind": "flow",
  "title": "What happens to a file you drop on a board",
  "steps": [
    { "label": "Read the text layer", "note": "Glyph indices resolved through the font's own character map — which is what makes a modern export legible rather than mojibake.", "hue": "read" },
    { "label": "Check it is legible", "note": "A page that decodes to noise is REFUSED rather than shown. A confident wrong transcription is worse than an honest gap.", "hue": "prove" },
    { "label": "Escalate what failed", "note": "No text layer, or an encrypted file: the page image goes to a model that reads documents, and comes back transcribed.", "hue": "build" },
    { "label": "Keep the original", "note": "Signed in, it goes to storage; signed out, it rides with the board — so the escalation is still possible later.", "hue": "measure" }
  ],
  "caption": "The escalation door was open the whole time and nothing read through it: unreadable drops were retained and never re-attempted."
}
```

Then there is the other kind: a page that contains no text because it never did. A photographed contract. A scan of a signed agreement. A résumé someone printed, signed and re-scanned. An encrypted file that refuses extraction outright.

No character map helps there, and a reader that promises to try will happily produce a confident wrong answer. So the honest path is escalation: recognise that the page has no text layer, hand the actual image to a model that can read pictures of documents, and transcribe it.

Three decisions in that escalation are worth stating, because they are where this kind of feature usually goes wrong:

- **It transcribes; it does not summarise.** The caller turns the result into a document somebody will edit. A summary silently substituted for a transcription is a document that has quietly lost the clause you needed.
- **It marks what it cannot read.** An illegible word comes back marked as illegible rather than guessed. A guess in a contract is worse than a gap in one.
- **It keeps the original.** Signed in, the file goes to storage and the board keeps a key. Signed out — a board with no account yet — the bytes ride along with the board itself. Either way the escalation is possible later, which it was not when unreadable drops were discarded.

## What this changes

```bf-figure
{
  "kind": "stack",
  "title": "Things that now complete rather than stall",
  "bands": [
    { "label": "A résumé", "note": "Dropped as a PDF or a Word file, read directly, and restyled through the template engine — no third-party parse account, no retyping.", "hue": "growth" },
    { "label": "A signed contract", "note": "Scanned, transcribed, and placed on the board beside the deal it belongs to.", "hue": "run" },
    { "label": "A statement or invoice", "note": "Read into figures you can put beside the rest of your money, instead of an attachment nobody opens.", "hue": "run" },
    { "label": "An old policy document", "note": "Image-only, decades old, and now searchable text you can quote in an answer.", "hue": "measure" }
  ],
  "caption": "The same path serves all four, because the difference between them is which reader ran — not which product you had to open."
}
```

There is a wider point here about products that hold your documents. The moment a file lands somewhere unreadable, everything downstream of it is manual: the summary, the extraction, the comparison, the search. Teams do not usually notice this as a document problem. They notice it as "we ended up doing that bit by hand."

Reading is the first act of [Idea to Real](/blog/idea-to-real-the-operating-methodology) for a reason. A brief, an RFP, a contract, a scanned page of notes from a workshop — the method starts by understanding what you actually said, and it cannot start at all against a file that arrived as an icon.

---

**Related reading:** [Parse a résumé PDF to structured JSON](/blog/parse-resume-pdf-to-structured-json) · [How to score your résumé for ATS](/blog/how-to-score-your-resume-for-ats) · [Every diagram format the canvas reads](/blog/every-diagram-format-the-canvas-reads)

[Open a canvas](/create) and drop the file that never worked anywhere else.
