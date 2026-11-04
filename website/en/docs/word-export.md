---
title: Word export (beta)
description: Export an Obsidian note as a Word document (.docx) laid out like the PDF report, or filled into your company's own .dotx template — cover, headers, footers and styles kept, markers replaced, a real Word table of contents.
---

# Word export (beta)

The same note, with the same confidentiality filter, can leave as a Word document (`.docx`) instead of a PDF. Two ways:

- **Without a Word template**, the document is laid out like the PDF: same cover, header and footer bands, references page, TLP reminder and table of contents, in the template's colours — or with its own letterhead artwork and the note's logo.
- **With a Word template of your own** (`.dotx` or `.docx`), the plugin fills it: its cover page, headers, footers, theme and styles stay as they are, and the report goes where you put `{{content}}`.

!!! warning "Beta"
    The Word export is new in 1.2 and was checked in Microsoft Word. LibreOffice and Google Docs are not tested yet. If a document opens wrongly, please [open an issue](https://github.com/Phdhebde/Obisidian-pdf-export/issues) with the note and, if you can, the Word template.

## Export

| How | What it does |
|---|---|
| **Export as Word document (beta)** command | Exports the active note |
| **Export as Word document with a profile… (beta)** command | Exports one version: the full one, or a profile such as *Client* (see [Confidential export](confidential-export.md)) |
| **Right-click a note** → **Export as Word document (beta)** | Exports that note |

The file goes where the PDF would: same folder, same name, with the `.docx` extension. The template picker and the profiles work as for the PDF.

!!! info "Word asks to update the fields"
    When the document opens, Word asks *"This document contains fields that may refer to other files. Do you want to update the fields in this document?"* Answer **Yes**: Word then adds the page numbers to the table of contents. The entries and their links are already there, so a reader who answers no still gets a working table of contents.

## Use your own Word template

1. Open your company's template in Word and write markers where the note's values go — on the cover, in headers and footers:

    | Marker | Replaced by |
    |---|---|
    | `{{title}}` | The note's `title` |
    | `{{subtitle}}` | `subtitle` |
    | `{{acronym}}` | `acronym` |
    | `{{client}}` | `client` |
    | `{{author}}` | `author` |
    | `{{version}}`, `{{date}}`, `{{status}}` | The last line of `versions` (the date defaults to today) |
    | `{{tlp}}` | The TLP marking, bold, in its colour (`TLP:AMBER`) |
    | `{{toc}}` | A Word table of contents, alone in its paragraph |
    | `{{content}}` | The report, alone in its paragraph |

2. Save it as `.dotx` or `.docx` into the vault. Macro-enabled files (`.dotm`, `.docm`) are refused.
3. In **Settings → PDF Report Exporter**, open the plugin template to use, then **Word export (beta) → Word template → Choose…**.

Markers keep the formatting of the text they replace. Word sometimes splits a marker into several pieces after a spell check or a formatting change; the plugin finds it anyway. A marker written in the note itself is left as it is.

Without a `{{content}}` paragraph, the report is added at the end of the template, and a notice says so.

## Styles

Each element of the note takes a Word style, found in the template by its **internal name** — the same in every language, so a template saved by a French Word (`Titre 1`) works like an English one (`Heading 1`):

| Element | Default style |
|---|---|
| Body text | Normal |
| Headings 1–6 | Heading 1 … Heading 6 |
| List items | List Paragraph |
| Captions | Caption |
| Code blocks | HTML Preformatted |
| Inline code | HTML Code |
| Links | Hyperlink |
| Tables | Table Grid |
| Table of contents | TOC Heading, TOC 1 … TOC 6 |

The **Word styles** table in the settings points any element at another style of the template — for example body text at your *Body Text* style. A style the template lacks is added to the document, drawn from the plugin template's colours and fonts.

## What is rendered

| In the note | In Word |
|---|---|
| Headings | The template's heading styles, numbered like the PDF (`A.`, `1.`…), bookmarked for the table of contents |
| Bold, italic, strikethrough, inline code, `<br>` | Direct formatting and the inline code style |
| Links | Real Word hyperlinks |
| Bulleted, numbered and task lists | Word numbering; ☐ and ☑ boxes |
| Tables | The table style, with the header row repeated on each page |
| Images | Embedded, at the requested width |
| Code blocks | The code style: monospace, shaded, spaces and tabs kept |
| Callouts | A tinted box with a bar of their colour, their icon and a coloured title |
| Mermaid diagrams | Drawn by Obsidian, embedded as vector images, with a picture for older Word versions |
| `\pagebreak`, `---` | Page breaks and rules |
| Restricted passages | Labelled and highlighted in the full version, removed from the others — as in the PDF |

Not yet: "Figure 1: …" captions as Word captions, footnotes as Word footnotes, and side-by-side columns (they follow one another for now). They are planned for 1.3 — see the [roadmap](roadmap.md).

## Checked in CI

Every build writes sample documents — generated, with artwork, from the example notes and from a Word template — and checks them with Microsoft's Open XML validator, so a change that would make Word report *"unreadable content"* cannot ship. The confidentiality tests check the Word file too: no restricted text reaches a client `.docx`.
