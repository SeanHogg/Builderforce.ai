---
title: How to Parse a Resume PDF Into Structured JSON (Developer Guide)
date: 2026-04-08
description: A technical guide to resume parsing: how to extract structured data from PDF resumes using AI, with schema examples, common pitfalls, and integration patterns.
tags: [developer-tools, api, pdf-to-json, resume-api, resume-parser, resume-extraction]
author: Sean Hogg
---

# How to Parse a Resume PDF Into Structured JSON (Developer Guide)

## The Resume Parsing Problem

Resumes are unstructured by nature. There's no universal standard for layout, section naming, date formatting, or content organization. A resume might list education first or last, use "Work Experience" or "Professional Background" or "Career History", format dates as "2020–2023" or "Jan 2020 - Dec 2023" or "1/2020 to 12/2023."

For any system that needs to process resumes at scale — ATS platforms, job boards, HR analytics, recruiting CRMs — this unstructured data must be converted to a consistent, machine-readable format. That's resume parsing.

Traditional regex-based parsers break on 20–30% of resumes due to layout variations. Modern AI-powered parsers like Builderforce's PDF to JSON tool achieve 95%+ extraction accuracy by understanding context, not just pattern-matching.

## The Output Schema

Builderforce's PDF to JSON tool produces a clean JSON object with these top-level fields:

```json
{
  "basics": {
    "name": "string",
    "email": "string",
    "phone": "string",
    "location": "string",
    "linkedin": "string",
    "website": "string",
    "summary": "string"
  },
  "work": [
    {
      "company": "string",
      "position": "string",
      "startDate": "YYYY-MM",
      "endDate": "YYYY-MM | Present",
      "highlights": ["string"]
    }
  ],
  "education": [
    {
      "institution": "string",
      "degree": "string",
      "field": "string",
      "graduationDate": "YYYY"
    }
  ],
  "skills": ["string"],
  "certifications": ["string"]
}
```

This schema is compatible with the JSON Resume standard, making it easy to integrate with existing tools and pipelines.

## How to Use the Parser

**Interactive (browser):**
1. Open the PDF to JSON tool at Builderforce/tools/pdf-to-json.
2. Drop a PDF file or paste resume text.
3. Click Parse — the AI extracts structured data and displays the JSON.
4. Copy the JSON or download as a .json file.

The parser handles multi-column layouts, tables, creative formatting, and non-standard section headings. It works with PDFs generated from Word, Google Docs, LaTeX, Canva, and design tools.

## Common Parsing Pitfalls

**Image-only PDFs.** Some PDFs are scanned images, not text. These require OCR before parsing. Builderforce's parser includes OCR for scanned documents, but accuracy drops to ~85% for low-quality scans.

**Multi-language resumes.** The parser works best with English resumes. Support for other languages is improving but may miss nuances in date formatting and section naming.

**Heavily designed resumes.** Resumes with infographics, timelines, skill bars, and circular layouts lose some formatting nuance during extraction. The data is still captured, but visual-only elements (like a "85% Python proficiency" skill bar) may not translate to the JSON output.

**Merged roles.** If someone lists two titles at the same company on one line ("Senior Engineer → Staff Engineer, 2020–2024"), the parser may create one entry instead of two. Spot-check these cases.

## Frequently Asked Questions

### What file formats does the parser accept?

The PDF to JSON tool accepts PDF and DOCX files, as well as pasted plain text. PDF files can be text-based or scanned (OCR is included).

### Is the output compatible with JSON Resume format?

Yes. The output schema follows the JSON Resume standard (jsonresume.org) with minor extensions for certifications and skills. You can use the output directly with any JSON Resume-compatible tool or theme.

---

**Try it:** [PDF to JSON](/tools/pdf-to-json) on Builderforce.
