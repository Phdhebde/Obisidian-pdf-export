---
title: Templates
description: Customise PDF Report Exporter templates — sections, heading numbering, colours, fonts, cover layout, page numbers, fixed labels and your own letterhead artwork — and share them as JSON files.
---

# Templates

A template decides how a report looks; the note decides what it says. Templates live in **Settings → PDF Report Exporter**. A template named **Report** is created on first launch, and you can add as many as you need: **new**, **duplicate**, **export as JSON**, **import a JSON**, **delete**.

## What a template sets

Sections and their order
:   Cover, References, TLP reminder, Table of contents, Content. The cover always stays first.

Headings and table of contents
:   For each of the six levels: its numbering (`1.`, `A.`, `a)`, `I.`, `i.` or none), whether it is listed in the table of contents, and whether it starts a new page. Hierarchical numbering (`1.1`, `1.A`…) is one switch away.

Colours
:   Main colour, header and footer bands and their text, table header, body and borders, links, table of contents title, body text, TLP badges.

Typography
:   Body and heading fonts, a single **text size** slider (7 to 18 pt) that everything scales from, justified or left-aligned text, callout icons, diamond bullets, embedded notes, page margins.

Cover page
:   Position and size of the title, rule, subtitle, acronym and logo, in points from the top-left corner (A4 = 595 × 842 pt). A title too long for its place shrinks, then pushes the rule and subtitles down.

Header and footer
:   Text position, and the page number format: `page {{page}}/{{total}}`, `{{page}}`, `Page {{page}} of {{total}}`, none, or your own.

Fixed labels
:   "Document references", table headers, TLP reminder titles… — editable, in any language.

Artwork
:   By default the template draws its own decoration in its colours. Pick full-page A4 images from the vault to replace the cover background and the page frame with your own letterhead; the title, client, page numbers and markings stay live text on top. A default logo can be set too.

## Share a template with your team

**Export this template** writes a self-contained `.report-template.json` file into the vault, images included. A colleague drops that file into their vault and imports it from the same list. Imported templates only accept embedded PNG and JPEG images, so a shared file cannot point the plugin at other files in the vault.

## Global settings

- **Output folder** for the PDFs (empty means the vault root).
- **File name**, with the tokens `{{note}}`, `{{title}}`, `{{client}}`, `{{tlp}}`, `{{date}}` and `{{version}}`. Empty tokens are removed along with their dashes.
- **When the PDF already exists:** ask, keep both (numbered name) or overwrite.
- **Default contacts**, used by *Insert report frontmatter*.
- **Confidential passages:** audience levels, export profiles, labelling and the export log — see [Confidential export](confidential-export.md).

On Obsidian 1.13 and later, every setting is also reachable from Obsidian's settings search.
