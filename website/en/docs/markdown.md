---
title: Markdown support
description: How PDF Report Exporter renders Obsidian Markdown in a PDF — numbered headings, callouts with icons, tables fitted to the page, task lists, Mermaid diagrams as vectors, Obsidian Columns, images, embedded notes and page breaks.
---

# Markdown support

PDF Report Exporter reads the Markdown you already write in Obsidian. Nothing needs to change in your notes.

| Markdown | In the PDF |
|---|---|
| `# Heading` | Level 1 heading in the template's main colour, listed in the table of contents |
| `##` to `######` | Numbered automatically — `A.`, `1.`, `a)` by default, configurable per level |
| `**bold**`, `*italic*`, `~~strike~~`, `` `code` `` | Inline formatting |
| `[text](url)` | Link, clickable in the PDF for `http(s)` and `mailto:` |
| `[[Page]]`, `[[Page\|alias]]` | Flattened to readable text |
| `- item`, `1. item` | Lists |
| `- [ ]`, `- [x]` | Task lists, with vector check boxes |
| List under a `# Recommendations` heading | Diamond bullets in the main colour (can be turned off) |
| `> [!warning] Title` | Obsidian callout with the icon and colour of its type |
| `> quote` | Quote box with an accent bar |
| `| col | col |` | Styled table; a table too wide for the page is fitted to it |
| ` ``` ` | Code block |
| ` ```mermaid ` | Mermaid diagram, drawn by Obsidian's own Mermaid and embedded as vectors |
| ` ```col `, `> [!col]` | Columns from the [Obsidian Columns](https://github.com/tnichols217/obsidian-columns) plugin, all three syntaxes |
| `*Figure 1: …*` | Centred italic caption |
| `%%comment%%` | Left out, as in Obsidian's reading view |

Callout types: `note`, `tip`, `info`, `todo`, `success`, `question`, `warning`, `failure`, `danger`, `bug`, `example`, `quote` and their aliases.

Only paragraphs starting with *Figure*, *Table*, *Chart*, *Diagram*, *Illustration*, *Appendix*, *Exhibit* or *Listing* (or their French equivalents) become captions; an ordinary italic paragraph stays body text.

## Images

`![[capture.png]]`, `![[capture.png|400]]` (width) and `![alt](path/capture.png)` all work. PNG and JPEG are embedded as they are; WEBP, GIF, SVG, BMP, AVIF and TIFF are converted to PNG. A missing image is flagged in the report and in a notice instead of failing the export. An image repeated in the note is embedded only once, and an image reference written inside a code block is left alone.

## Embedded notes

`![[another note]]` inlines that note's content, up to three levels deep; circular embeds are detected. A template can switch this to *mention only*. Notes marked with `audience:` or `tlp:` are left out of restricted versions — see [Confidential export](confidential-export.md).

## Page breaks

Put `\pagebreak` on its own line — or `\newpage`, `[pagebreak]`, `<!-- pagebreak -->`, `<div style="page-break-after: always"></div>`. A template can also start every heading of a given level on a new page.

## Limits

- **Fonts:** Liberation Sans (metric-compatible with Arial), Liberation Mono and Archivo Black are embedded — which is why the plugin weighs about 5 MB. Scripts they do not cover (CJK, Arabic…) will not render.
- **Table of contents:** entries are clickable but have no dot leaders.
- **Wide tables:** columns get widths proportional to their content, the font shrinks down to 7 pt if needed, and as a last resort over-long words break between characters — no character is added, so a hash copied from the PDF stays exact.
- **Columns** are not split across pages.
- Dataview and other dynamic queries are not rendered. Page size is A4.
