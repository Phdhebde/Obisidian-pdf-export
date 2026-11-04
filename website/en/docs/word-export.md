---
title: Word export
description: Export an Obsidian note as a Word document (.docx) laid out like the PDF report, or filled into your company's own .dotx template — cover, headers, footers and styles kept, markers replaced, a real Word table of contents, footnotes and captions.
---

# Word export

The same note, with the same confidentiality filter, can leave as a Word document (`.docx`) instead of a PDF. Two ways:

- **Without a Word template**, the document is laid out like the PDF: same cover, header and footer bands, references page, TLP reminder and table of contents, in the template's colours — or with its own letterhead artwork and the note's logo.
- **With a Word template of your own** (`.dotx` or `.docx`), the plugin fills it: its cover page, headers, footers, theme and styles stay as they are, and the report goes where you put `{{content}}`.

!!! info "Checked in Word and LibreOffice"
    The Word export is checked in Microsoft Word, and every build opens its sample documents in LibreOffice (see [below](#libreoffice-and-google-docs)). If a document opens wrongly, please [open an issue](https://github.com/Phdhebde/Obisidian-pdf-export/issues) with the note and, if you can, the Word template.

## Export

| How | What it does |
|---|---|
| **Export as Word document** command | Exports the active note |
| **Export as Word document with a profile…** command | Exports one version: the full one, or a profile such as *Client* (see [Confidential export](confidential-export.md)) |
| **Right-click a note** → **Export as Word document** | Exports that note |

The file goes where the PDF would: same folder, same name, with the `.docx` extension. The template picker and the profiles work as for the PDF.

!!! info "Word asks to update the fields"
    When the document opens, Word asks *"This document contains fields that may refer to other files. Do you want to update the fields in this document?"* Answer **Yes**: Word then adds the page numbers to the table of contents and numbers the captions. The entries and their links are already there, so a reader who answers no still gets a working table of contents.

## Use your own Word template

1. Open your company's template in Word and write markers where the note's values go — on the cover, in headers and footers, in a table:

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
3. In **Settings → Report Exporter**, open the plugin template to use, then **Word export → Word template → Choose…**.

Markers keep the formatting of the text they replace. Word sometimes splits a marker into several pieces after a spell check or a formatting change; the plugin finds it anyway. A marker written in the note itself is left as it is.

Without a `{{content}}` paragraph, the report is added at the end of the template, and a notice says so.

### Tips for a template that works well

- **Number headings in the template, or not at all.** When the template's *Heading 1*, *Heading 2*… are numbered by Word (a multilevel list linked to them), the plugin leaves the numbering to Word. Otherwise it writes the plugin template's numbering (`A.`, `1.`…) as text, as in the PDF.
- **Put the cover first and `{{content}}` on a page of its own.** Give the paragraph that holds `{{content}}` *Page break before*, or put a page break above it, so the report starts on a new page.
- **Use a different first page** (*Layout → Different First Page*) for a cover without the running header.
- **Name your styles as you like.** A custom style such as *Report body* is offered in the **Word styles** table of the settings, where you point *Body text* at it.
- **Page size and orientation come from the template.** Tables, images and columns take the width of its text area, portrait or landscape.
- **Footnotes already in the template are kept**; the note's own come after them.

### Example templates

Three freely licensed templates, written in Word and used by the test bench, are in the repository's [`templates/word`](https://github.com/Phdhebde/Obisidian-pdf-export/tree/main/templates/word) folder. Download one into your vault to start from it:

| Template | What it shows |
|---|---|
| [`consulting-report.dotx`](https://github.com/Phdhebde/Obisidian-pdf-export/raw/main/templates/word/consulting-report.dotx) | Cover with every marker, `{{toc}}` on its own page, headings numbered by Word (1., 1.1.), running header from the second page, TLP and page number in the footer |
| [`memo.dotx`](https://github.com/Phdhebde/Obisidian-pdf-export/raw/main/templates/word/memo.dotx) | No cover: markers in a table at the top, a custom *Corps de rapport* body style to pick in the settings |
| [`landscape-brief.dotx`](https://github.com/Phdhebde/Obisidian-pdf-export/raw/main/templates/word/landscape-brief.dotx) | A4 landscape, narrow margins, a footnote of its own |

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
| Footnotes, footnote numbers | Footnote Text, Footnote Reference |
| Table of contents | TOC Heading, TOC 1 … TOC 6 |

The **Word styles** table in the settings points any element at another style of the template — for example body text at your *Body Text* style. A style the template lacks is added to the document, drawn from the plugin template's colours and fonts.

## What is rendered

| In the note | In Word |
|---|---|
| Headings | The template's heading styles, numbered by the template or like the PDF (`A.`, `1.`…), bookmarked for the table of contents |
| Bold, italic, strikethrough, inline code, `<br>` | Direct formatting and the inline code style |
| Links | Real Word hyperlinks |
| Bulleted, numbered and task lists | Word numbering; ☐ and ☑ boxes |
| Tables | The table style, with the header row repeated on each page |
| Images | Embedded, at the requested width |
| `*Figure 1: …*`, `Table 2: …` | Word captions: the number is a sequence field, so Word's *Insert Table of Figures* lists them and renumbers them when one is added. `Fig.` counts with the figures |
| `text[^1]`, `[^1]: note`, `text^[inline note]` | Real Word footnotes, at the foot of the page that cites them; a note cited twice shows the same number |
| Columns (` ````col `, `> [!col]`) | Side by side in a borderless table, each as wide as its `flexGrow` share, with their border and alignment; a row of columns is not split across pages |
| Code blocks | The code style: monospace, shaded, spaces and tabs kept |
| Callouts | A tinted box with a bar of their colour, their icon and a coloured title |
| Mermaid diagrams | Drawn by Obsidian, embedded as vector images, with a picture for older Word versions |
| `\pagebreak`, `---` | Page breaks and rules |
| Restricted passages | Labelled and highlighted in the full version, removed from the others — as in the PDF |

## LibreOffice and Google Docs

The Word export is written for Microsoft Word and checked in it. Every build also opens each sample document in **LibreOffice** and prints it to PDF, so a file LibreOffice cannot open cannot be released. Rendering details can still differ from Word's:

- If the table of contents has no page numbers, or the captions keep the number written in the note, update the fields: *Tools → Update → Update All* in LibreOffice.
- Fonts the template names but the computer lacks are replaced by LibreOffice's nearest ones, which can change line breaks.

**Google Docs** is not tested. If you use it, tell us in the [issues](https://github.com/Phdhebde/Obisidian-pdf-export/issues) what works and what does not.

## Checked in CI

Every build writes sample documents — generated, with artwork, from the example notes, from a Word template, and from each of the three example templates — then:

- checks them with Microsoft's Open XML validator, so a change that would make Word report *"unreadable content"* cannot ship;
- opens them in LibreOffice.

The confidentiality tests check the Word file too: no restricted text — footnotes included — reaches a client `.docx`.
