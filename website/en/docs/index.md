---
title: Export Obsidian notes as professional PDF and Word reports
description: Report Exporter (formerly PDF Report Exporter) is a free, open-source Obsidian plugin that turns a Markdown note into a polished PDF or Word report — cover page, table of contents, templates, Mermaid diagrams, callouts, footnotes — and a client version without the internal passages.
---

# Export Obsidian notes as professional PDF and Word reports

**Report Exporter** is a free, open-source [Obsidian](https://obsidian.md) plugin that turns a Markdown note into a report you can send: a cover page, header and footer bands, a table of contents, styled tables, Obsidian callouts with their icons, Mermaid diagrams drawn as vectors, footnotes. Templates set the look; the note stays plain Markdown.

One note, several deliverables:

- **A PDF**, laid out from the plugin's templates — your colours, fonts, logo and letterhead, nothing else to install.
- **A Word document**, laid out like the PDF, or filled into your company's own `.dotx` template so the house style comes from the template itself.
- **A version per audience**: the full internal report, and a client version from which the passages marked internal are removed before rendering.

Report Exporter was called *PDF Report Exporter* until version 2.0; the plugin, its settings and its commands are the same. How it compares with Obsidian's built-in export, Better Export PDF and the others: [Obsidian PDF export plugins compared](compare.md).

[Get started](getting-started.md){ .md-button .md-button--primary }
[Download the latest release](https://github.com/Phdhebde/Obisidian-pdf-export/releases/latest){ .md-button }

<div class="grid" markdown>

![Cover page of a report exported from Obsidian with Report Exporter](assets/images/report-cover.webp){ loading=lazy width="300" }

![Body page with numbered headings, a list and a styled table](assets/images/report-body.webp){ loading=lazy width="300" }

</div>

## What it does

| You write in Obsidian | You get in the report |
|---|---|
| A note with a few frontmatter keys (`title`, `client`, `versions`, `contacts`) | A cover page, a references page with document status and contacts, header and footer on every page |
| `#`, `##`, `###` headings | Numbered headings (`A.`, `1.`, `a)`… configurable) and a table of contents: clickable and paginated in the PDF, a real Word table of contents in the `.docx` |
| `> [!warning]` callouts, tables, task lists, code | Callouts with their Lucide icons, tables fitted to the page, check boxes, code blocks |
| ` ```mermaid ` blocks | Diagrams drawn by Obsidian's own Mermaid, embedded as vectors |
| `![[image.png]]`, `![[another note]]` | Embedded images (WEBP, SVG, GIF… converted) and inlined notes |
| `text[^1]`, `*Figure 1: …*` | Footnotes and captions — real Word footnotes and numbered captions in the `.docx` |
| `## Pricing %%internal%%` | A full internal version, and a client version with that section removed |

## Why use it

- **Reports, not printouts.** Obsidian's built-in *Export to PDF* prints the note as it looks on screen. Report Exporter lays it out as a document: cover, table of contents, page numbers, running header, TLP marking.
- **PDF or Word, from the same note.** Send a PDF, or a `.docx` your client can edit — in their own template if they have one. See [Word export](word-export.md).
- **Templates you can share.** Colours, fonts, numbering, cover layout, page number format and your own letterhead artwork live in templates. Export one as a JSON file and a colleague imports it.
- **One note, several audiences.** Mark what must stay internal; export a full version for the team and a client version from which those passages are removed before rendering — never hidden under a black box. See [Confidential export](confidential-export.md).
- **Private by design.** No network access, no account, no telemetry. The fonts ship inside the plugin, so it works offline.
- **English and French.** The interface follows Obsidian's language, and frontmatter keys are understood in both.

## Install in one minute

1. In Obsidian, open **Settings → Community plugins → Browse**.
2. Search for **Report Exporter**, install it, then enable it.
3. Open a note and run **Export as PDF report** or **Export as Word document** from the command palette (++ctrl+p++ / ++cmd+p++).

Details, manual installation and the first-export walkthrough: [Getting started](getting-started.md).

!!! info "Requirements"
    Obsidian **1.8.7 or later**, on desktop (Windows, macOS, Linux). Mobile is not supported: the PDF engine and fonts need the desktop app.

## Free and community-driven

The plugin is MIT-licensed, has no paid tier and never will. Ideas, bug reports, Word templates and translations are welcome: see [how to contribute](https://github.com/Phdhebde/Obisidian-pdf-export/blob/main/CONTRIBUTING.md) and the [roadmap](roadmap.md).
