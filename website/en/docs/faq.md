---
title: FAQ
description: Answers to common questions about PDF Report Exporter for Obsidian — price, privacy, mobile support, the difference with Obsidian's built-in PDF export, letterheads, confidential versions, Mermaid and languages.
---

# Frequently asked questions

## How do I export an Obsidian note to PDF with a cover page and a table of contents?

Install **PDF Report Exporter** from the community plugin store, open the note and run **Export as PDF report** from the command palette. The cover page is filled from the note's frontmatter (`title`, `client`, `subtitle`), and the table of contents is built from its headings, with page numbers and clickable entries. See [Getting started](getting-started.md).

## Is PDF Report Exporter free?

Yes. It is open source under the MIT licence, with no paid tier, no account and no usage limit.

## Does the plugin send my notes anywhere?

No. It makes no network request: the PDF is generated on your computer, and the fonts it needs are bundled inside the plugin. It works offline.

## How is it different from Obsidian's built-in "Export to PDF"?

Obsidian's built-in export prints the note as it looks on screen. PDF Report Exporter lays the note out as a report: a cover page, a references page with document status and contacts, a running header and footer, numbered headings, a clickable table of contents, styled tables and callouts, and an optional TLP marking — all driven by reusable templates.

## Can I use my company's letterhead or branding?

Yes. A template sets colours, fonts, margins, numbering and the cover layout, and can replace the built-in decoration with your own full-page A4 images for the cover and the page frame. Text stays live on top. See [Templates](templates.md).

## Can I send a client a version without the internal parts?

Yes, since version 1.1. Mark sections, callouts, phrases or whole notes as `internal`, then run **Export all versions as PDF reports**: you get the full version and a client version from which those passages are removed before rendering. See [Confidential export](confidential-export.md).

## Does it work on mobile?

No. The plugin is desktop only (Windows, macOS, Linux): the PDF engine and the embedded fonts need the desktop app.

## Which Obsidian version do I need?

Obsidian 1.8.7 or later.

## Are Mermaid diagrams supported?

Yes. Diagrams are drawn by Obsidian's own Mermaid and embedded as vectors, so they stay sharp at any zoom. An invalid diagram is printed as code with a notice.

## Which languages are supported?

The interface is in English and French and follows Obsidian's language. Frontmatter keys are understood in both languages, and every fixed label printed in the PDF can be rewritten in any language. The embedded fonts cover Latin scripts; CJK and Arabic text will not render.

## Why is the plugin about 5 MB?

The fonts are embedded in `main.js`, because the community store only distributes that file, the manifest and the stylesheet. That is what lets the plugin work offline without installing anything else.

## Can I export a whole folder at once?

Yes. Right-click a folder in the file explorer: every note in it is exported, one PDF each, with a summary at the end.

## Will there be a Word (.docx) export?

It is the next major step on the [roadmap](roadmap.md): Word export based on your own `.dotx` template, so the company's house style comes from the template itself.

## How do I report a bug or suggest a feature?

Open an issue on [GitHub](https://github.com/Phdhebde/Obisidian-pdf-export/issues). Including the plugin version, the Obsidian version and a small note that reproduces the problem helps a lot.
