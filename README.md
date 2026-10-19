# PDF Report Exporter

*[Version française](README.fr.md)*

Export any Obsidian note as a **polished PDF report**: cover page, header and footer bands, clickable paginated table of contents, styled tables, Obsidian callouts with their icons, Mermaid diagrams as vectors, columns, images — all driven by **templates** you can customise, duplicate and share, and pick at export time.

The plugin works entirely offline: it makes no network request, and the fonts it needs ship inside the plugin.

---

## Installation

**From the community plugin store:** *Settings → Community plugins → Browse*, search for **PDF Report Exporter**, install, then enable it.

**Manually:** download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/Phdhebde/Obisidian-pdf-export/releases/latest) into `<vault>/.obsidian/plugins/pdf-report-exporter/`, then enable the plugin.

Desktop only.

---

## Usage

### Exporting

| How | What it does |
|---|---|
| **Export as PDF report** command (`Ctrl/Cmd+P`), or the ribbon icon | Exports the active note |
| **Preview PDF report** command | Renders the PDF and **opens it inside Obsidian** — the quick way to tune a template |
| **Export selection as PDF report** command | Exports only the selected text |
| **Export as PDF report with a profile…** command | Exports one version of the note: the full one, or a profile such as *Client* (see Confidential passages) |
| **Export all versions as PDF reports** command | Writes the full version and one PDF per profile, each with its own name |
| **Right-click a note** in the file explorer | Exports that note |
| **Right-click a folder** | Exports every note in it, one PDF each, with a summary at the end |
| **Insert report frontmatter** command | Inserts a pre-filled YAML block (today's date, default contacts) |

When you have several templates, a picker asks which one to use (keyboard: `↑ ↓`, `Enter`, `Esc`). It is skipped when there is only one template, when the note names one in its frontmatter, or once you tick **Don't ask again**.

The preview always reuses the same file and tab, so iterating on a template clutters neither the vault nor the workspace.

### Frontmatter

The note's properties fill the cover, the header, the references page and the PDF metadata. Every key is optional, and English and French keys are both understood:

```yaml
---
title: Website Migration Review     # cover + header (default: the note name)
client: ACME Corp                   # under the title in the header
subtitle: Infrastructure team       # under the cover title
acronym: INFRA                      # large, under the subtitle
author: Jane Doe                    # PDF metadata
logo: logos/acme.png                # logo on the cover (vault path or [[link]])
template: Report                    # force a template, skipping the picker
sections: [cover, toc, body]        # override the template's sections for this note
tlp: AMBER                          # optional Traffic Light Protocol marking
versions:                           # "Document status" table
  - version: "1.0"
    date: "2026-06-08"
    status: "Document created"
contacts:                           # "Contacts" table
  - name: "Jane Doe"
    role: "Project lead"
    email: "jane.doe@example.com"
recipients:                         # "Recipients" table (optional)
  - name: "John Smith"
    company: "ACME Corp"            # or `role:`, which takes precedence
    email: "john.smith@example.com"
---
```

French equivalents: `titre`, `sous_titre`, `acronyme`, `auteur`, `modele`, `destinataires`, and inside the lists `nom`, `poste`, `courriel`, `societe`, `etat`.

**Recipients:** the table only appears when the note names at least one recipient, or when the template turns it on. An entry with every field empty is ignored, so the block inserted by the frontmatter command has no effect until you fill it in.

**TLP (optional):** for teams that use the [Traffic Light Protocol](https://www.first.org/tlp/), `tlp: RED | AMBER | AMBER+STRICT | GREEN | CLEAR` prints the marking in the footer of every page. Without a `tlp` key nothing is printed — unless the template includes the *TLP reminder* page, in which case the report is marked `TLP:CLEAR`. An unrecognised value (`tlp: rouge`) raises a warning instead of being applied silently; `WHITE` (TLP 1.0) is accepted as `CLEAR`.

### Markdown

| Markdown | In the PDF |
|---|---|
| `# Heading` | Level 1 heading, in the template's main color, listed in the table of contents |
| `## …` to `######` | Numbered automatically — `A.`, `1.`, `a)` by default, configurable per level (see Templates) |
| `**bold**`, `*italic*`, `~~strike~~`, `` `code` `` | Inline formatting |
| `[text](url)` | Link, **clickable** in the PDF for `http(s)` and `mailto:` |
| `[[Page]]`, `[[Page\|alias]]` | Flattened to readable text |
| `- item` / `1. item` | Lists |
| `- [ ]` / `- [x]` | Task lists, with vector check boxes |
| List under a `# Recommendations` heading | Diamond bullets in the main color (can be turned off) |
| `> [!warning] Title` | **Obsidian callout**, with the icon and color of its type (`note`, `tip`, `info`, `todo`, `success`, `question`, `warning`, `failure`, `danger`, `bug`, `example`, `quote` and their aliases) |
| `> quote` | Quote box with an accent bar |
| `\| col \| col \|` | Styled table. A table too wide for the page is **fitted to it** (see Limits) |
| ```` ``` ```` | Code block |
| ```` ```mermaid ```` | **Mermaid diagram**, drawn by Obsidian's own Mermaid (light theme) and embedded **as vectors**. An invalid diagram is printed as code, with a notice |
| ```` ```col ```` / `> [!col]` | **Columns** from the [Obsidian Columns](https://github.com/tnichols217/obsidian-columns) plugin, all three syntaxes |
| `*Figure 1: …*` | Centered italic caption |

Only paragraphs starting with *Figure*, *Table*, *Chart*, *Diagram*, *Illustration*, *Appendix*, *Exhibit* or *Listing* (or their French equivalents) become captions; an ordinary italic paragraph stays body text.

**Page breaks:** put `\pagebreak` (or `\newpage`, `[pagebreak]`, `<!-- pagebreak -->`, `<div style="page-break-after: always"></div>`) on its own line. A template can also start every heading of a given level on a new page.

**Images:** `![[capture.png]]`, `![[capture.png|400]]` (width) and `![alt](path/capture.png)`. PNG and JPEG are embedded as they are; WEBP, GIF, SVG, BMP, AVIF and TIFF are converted to PNG. A missing image is flagged in the report and in a notice, rather than failing the export. An image repeated in the note is embedded only once, and an image reference written **inside a code block** is left alone.

**Embedded notes:** `![[another note]]` inlines that note's content (up to 3 levels deep; circular embeds are detected). A template can switch this to *mention only*.

**Comments:** Obsidian comments (`%%…%%`) are left out of every export, as they are hidden in reading view.

### Confidential passages

One note, several deliverables: a full internal version, and a version per audience — a client, a partner — from which the passages marked for the team are **removed before rendering**. They are never hidden under a black box: the text is not in the file at all, nor in its table of contents, links or metadata.

| Scope | In the note |
|---|---|
| Whole note | `audience: internal` in its frontmatter. Exporting it with a profile that leaves `internal` out stops with a message; embedded with `![[…]]` in another note, it is left out of that version. |
| Section | `## Pricing %%internal%%` — the heading and everything under it, down to the next heading of the same or a higher level |
| Block | `> [!internal] Negotiation` — the callout, its nested quotes, and the lines that continue it |
| Phrase | `<span data-audience="internal">12 %</span>` |
| By TLP level | `## Sources %%tlp:red%%`, `<span data-tlp="red">…</span>`, or `tlp: red` in the frontmatter of an embedded note |

**Profiles** (*Settings → Confidential passages*) say which levels a version keeps, the suffix added to its file name (`Report-client.pdf`), whether a "[passage removed]" mark shows where something was cut, and its TLP marking. A first install comes with a *Client* profile that removes every marked passage. A note can name its profile with `profile: Client`; without one, the usual export is the full version.

**Levels** are declared in the same settings: `internal` by default, add your own (`management`, `board`…). A passage marked with several levels leaves only in a version that keeps all of them.

**TLP:** a passage marked with a TLP level stays only in versions marked at least as strictly. A profile's marking is its own TLP setting, else the note's `tlp:`; with neither, the version counts as `TLP:CLEAR` and every TLP-marked passage goes. The full version keeps everything.

**Seeing what is restricted:** in a version that keeps them — the full one, typically — restricted sections, top-level `[!internal]` callouts and embedded notes open with an amber label (*INTERNAL*, *TLP:RED*…) and close with a dashed rule, and marked phrases are highlighted, so a reviewer sees what the other versions will not contain. In Obsidian itself, `[!internal]` callouts show in orange with a lock, and marked phrases with a dotted underline. The labelling in the PDF can be turned off in the settings.

**Export log (optional):** after each export with a profile, a line is added to a *PDF export log* note in the output folder — the note, the file written, and what was removed (counts, never the removed text).

**Fail closed:** an unknown level (`audience: internl`), or a marked phrase whose `</span>` is missing, stops the export with a message rather than letting the passage through. After each restricted export, a notice says what was removed, e.g. *Profile "Client": removed 1 section, 2 phrases.*

What is not covered: the frontmatter fields printed on the cover and the references page (title, client, contacts…) are not filtered — keep confidential details out of them.

To try it, export [example-confidential.md](example-confidential.md) with *Export all versions as PDF reports*.

---

## Templates

*Settings → PDF Report Exporter.* A template named **Report** is created on first launch. Buttons: **new**, **duplicate**, **export as JSON**, **import a JSON**, **delete** (with confirmation).

**Sharing:** *Export this template* writes a self-contained `.report-template.json` (images included) into the vault. A colleague drops that file into their vault and imports it from the same list.

Each template sets:

- **Sections** and their order: Cover, References, TLP reminder, Table of contents, Content. The cover always stays first.
- **Headings and table of contents:** for each of the six levels, its numbering (`1.`, `A.`, `a)`, `I.`, `i.` or none), whether it is listed in the table of contents, and whether it starts a new page; plus **hierarchical numbering** (`1.1`, `1.A`…).
- **Colors:** main color, header and footer bands and their text, table header/body/border, links, table of contents title, body text, TLP badges.
- **Typography:** body and heading fonts, **text size** (one slider, 7 to 18 pt, that everything scales from), justified or left-aligned text, callout icons, diamond bullets, embedded notes, page margins.
- **Cover page:** position and size of the title, rule, subtitle, acronym and logo, in points from the top-left corner (A4 = 595 × 842 pt). A title too long for its place shrinks, then pushes the rule and subtitles down.
- **Header and footer:** text position, and the **page number format** (`page {{page}}/{{total}}`, `{{page}}`, `Page {{page}} of {{total}}`, none, or your own).
- **Fixed labels:** "Document references", table headers, TLP reminder titles… — editable, in any language.
- **Artwork:** by default the template **draws its own decoration** in its colors (cover bar and bracket, header and footer bands). Pick full-page A4 images from the vault to replace the cover background and the page frame with your own letterhead; the title, client, page numbers and markings stay live text on top. A default logo can be set too.

### Global settings

- **Output folder** for the PDFs (empty = vault root).
- **File name**, with the tokens `{{note}} {{title}} {{client}} {{tlp}} {{date}} {{version}}`. Empty tokens are removed along with their dashes.
- **When the PDF already exists:** ask / keep both (numbered name) / overwrite.
- **Default contacts**, for the frontmatter command.

---

## Limits

- **Fonts:** Liberation Sans (metric-compatible with Arial), Liberation Mono and Archivo Black, embedded in the plugin — which is why `main.js` weighs about 5 MB. Scripts they do not cover (CJK, Arabic…) will not render.
- **Table of contents:** entries are clickable, but have no dot leaders: pdfmake builds the table of contents itself and offers no hook for them.
- **Wide tables:** a table that fits as equal columns keeps that layout. Otherwise columns get widths proportional to their content, the font shrinks (down to 7 pt) if needed, and as a last resort over-long words are broken between characters — no character is added, so a hash copied from the PDF stays exact.
- **Columns** are not split across pages: a group that does not fit is pushed whole to the next page.
- Dataview and other dynamic queries are not rendered.
- Page size is A4.

---

## Roadmap

Next: a confidential export (client and internal versions of the same note), then Word export based on your own `.dotx` template, as **Report Exporter**. Free and community-driven, no paid tier: see [ROADMAP.md](ROADMAP.md), and share your feedback in the issues.

---

## Development

```bash
npm install
npm run dev       # esbuild in watch mode
npm run check     # tsc --noEmit (strict)
npm run lint      # eslint with the rules of the Obsidian plugin review
npm test          # test suite, including an end-to-end PDF render
npm run build     # check + production build -> main.js
npm run version-bump 1.2.0   # sync package.json / manifest.json / versions.json
```

Tests run directly on the TypeScript sources (Node ≥ 22.18, native type stripping) — hence the explicit `.ts` extensions in imports.

**Releasing:** bump the version, commit, then push a tag equal to the version (no `v` prefix). The *Release* workflow tests, builds and creates a draft GitHub release with `main.js`, `manifest.json` and `styles.css`; publish that draft once checked. Do not create the release by hand on GitHub: a release without those files attached is rejected by the community plugin review.

```
src/
  main.ts        # plugin lifecycle, commands, context menus
  exporter.ts    # orchestration: frontmatter -> document -> PDF -> file
  generator.ts   # Markdown -> pdfmake document, theme and decoration (pure, tested)
  i18n.ts        # English and French interface strings
  textScan.ts    # code spans, wikilinks, callouts (pure, tested)
  columns.ts     # Obsidian Columns syntax (pure, tested)
  images.ts      # vault images -> pdfmake image dictionary
  mermaid.ts     # mermaid blocks -> standalone SVG, through Obsidian's Mermaid
  svgPaint.ts    # computed styles -> values pdfkit accepts (pure, tested)
  assets.ts      # embedded fonts, template images
  fonts.ts       # the TTFs, inlined by esbuild
  storage.ts     # data.json: defaults, migration, file names (tested)
  icons.ts       # Lucide callout icons as SVG (generated)
  tableLayout.ts # column widths of over-wide tables (pure, tested)
  textWidth.ts   # text width in the embedded fonts (pure, tested)
  fontMetrics.ts # glyph widths (generated by scripts/gen-metrics.mjs)
  settings.ts    # settings tab: template CRUD and editor
  modals.ts      # template picker, confirmation, file conflict
  types.ts       # shared types
```

## Credits and license

Code: [MIT](LICENSE). Bundled components and fonts are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md): pdfmake and marked (MIT), [Lucide](https://lucide.dev) icons (ISC), Liberation and Archivo Black fonts ([SIL OFL 1.1](fonts/OFL.txt)).
