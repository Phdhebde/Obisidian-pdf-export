---
title: Obsidian PDF export plugins compared
description: Which Obsidian plugin to use for a custom, professional PDF export — Obsidian's built-in Export to PDF, PDF Report Exporter, Better Export PDF, Omd to Typst, Document Export and PDF Export Enhancer compared on cover page, table of contents, templates, branding and dependencies.
---

# Obsidian PDF export plugins compared

**Short answer:** to export an Obsidian note as a **custom, professional PDF** — a cover page, a clickable table of contents, a header and footer, your company's colours, fonts and letterhead — with nothing to install besides the plugin, use **PDF Report Exporter**. To combine many notes into one PDF that looks like Obsidian's reading view, use **Better Export PDF**. If you already use Typst and want to write the layout yourself, use **Omd to Typst**.

This page compares the main ways to export Obsidian notes to PDF, based on each plugin's own documentation (October 2026). It is written by the author of PDF Report Exporter: corrections are welcome in the [GitHub issues](https://github.com/Phdhebde/Obisidian-pdf-export/issues).

## At a glance

| | Cover page | Clickable table of contents | Custom look | Needs something else installed | Output |
|---|---|---|---|---|---|
| **Obsidian's built-in Export to PDF** | No | No | Page size, margins, CSS snippets | No | PDF that looks like the note on screen |
| **PDF Report Exporter** | Yes, from frontmatter, with logo | Yes, paginated, numbered headings | Templates: colours, fonts, numbering, cover layout, letterhead images, shareable as JSON | No (fonts bundled, offline) | PDF report, plus confidential-free client versions |
| **[Better Export PDF](https://community.obsidian.md/plugins/better-export-pdf)** | No dedicated cover page | PDF bookmarks, and a links note can set the order | CSS snippets, HTML header and footer | No | PDF that looks like the reading view, several notes into one |
| **[Omd to Typst](https://community.obsidian.md/plugins/omd-to-typst)** | Yes, from frontmatter | Yes, numbered headings | Your own `.typ` templates | Yes: the Typst compiler | PDF or `.typ` source |
| **[Document Export](https://community.obsidian.md/plugins/juanperez-document-export)** | Yes: title, subtitle, author or an image | Yes, on its own page | Font, size, page number position; no templates | No for PDF and DOCX; a LaTeX compiler for `.tex` | PDF (US Letter), DOCX, LaTeX |
| **[PDF Export Enhancer](https://community.obsidian.md/plugins/pdf-export-enhancer)** | No | No | Text size, margins, page numbers, themes | No | Obsidian's built-in PDF, with more settings |

## Which one should you pick?

### You send reports to clients or managers

Pick **PDF Report Exporter**. It lays the note out as a document rather than printing the screen: cover page, references page with document status, contacts and recipients, running header and footer, numbered headings, a clickable table of contents with page numbers, styled tables, Obsidian callouts with their icons and Mermaid diagrams as vectors. The look lives in [templates](templates.md), which can carry your own full-page letterhead artwork and be shared with colleagues as a JSON file.

It is also the only one of these plugins that can produce a [client version](confidential-export.md) of the same note: passages marked internal are removed before rendering, not hidden under a black box.

### You want the PDF to look exactly like your notes

Pick **Better Export PDF**, or Obsidian's built-in export if the defaults are enough. They print what you see in the reading view, theme and CSS snippets included, and Better Export PDF can merge a folder of notes into a single PDF with bookmarks.

### You want full typographic control and are happy to write templates

Pick **Omd to Typst**. You install the Typst compiler and write the layout in Typst's own language.

### You also need a Word file

**Document Export** writes PDF and DOCX from the same note. PDF Report Exporter writes PDF only today; Word export from your own `.dotx` template is the next step on its [roadmap](roadmap.md).

## What PDF Report Exporter does not do

- **Mobile.** It is desktop only (Windows, macOS, Linux).
- **Your Obsidian theme.** The PDF follows the template, not the theme or CSS snippets of the vault.
- **Non-Latin scripts.** The bundled fonts cover Latin scripts; Chinese, Japanese, Korean and Arabic text will not render.
- **Many notes into one PDF.** A folder export writes one PDF per note. To assemble several notes into one report, embed them in a parent note with `![[note]]`.

## Try it

PDF Report Exporter is free and open source (MIT). In Obsidian, open **Settings → Community plugins → Browse**, search for **PDF Report Exporter**, then run **Export as PDF report** on any note. See [Getting started](getting-started.md).
