# Roadmap

PDF Report Exporter is becoming **Report Exporter**: one note, several deliverables — a PDF or a Word document, a full internal version or a redacted client version — from the same templates.

The project is and will stay **free and community-driven**: MIT licence, no paid tier, no account, no network access. Ideas, bug reports, templates and pull requests are welcome in the [issues](https://github.com/Phdhebde/Obisidian-pdf-export/issues).

| Version | Theme | Estimate | Ships when |
|---|---|---|---|
| 1.1 | Confidential export | ~4 weeks | Zero leaks on the sentinel note |
| 1.2 (beta) | Word export: the core | ~6 weeks | Opens without errors in Word and LibreOffice |
| 1.3 | Word export: complete | ~4 weeks | Three real-world templates render faithfully |
| 2.0 | Launch as Report Exporter | ~2 weeks | Published and announced |

Estimates are for a project built on spare time. Each version ships only when its exit criterion is met, and 1.1 is useful on its own.

---

## Architecture

```
note ──> Markdown analysis ──> confidentiality filter ──┬──> PDF engine  (pdfmake + plugin template) ──> report.pdf
         (existing)            (new, per profile)       └──> Word engine (OOXML + .dotx template)    ──> report.docx
```

The filter sits between the analysis and the renderers, so a single filter protects every output format.

- [ ] Extract an intermediate document representation from `generator.ts` (numbered headings, blocks, captions, resolved images) that both engines read.

---

## 1.1 — Confidential export

One note produces two deliverables: a complete internal version and a client version from which marked passages are **removed before rendering** — never hidden under a black box drawn over the text.

### Marking a passage

| Scope | Syntax in the note | What the author sees in Obsidian |
|---|---|---|
| Whole note | `audience: internal` in the frontmatter | Nothing special; the note is refused in a client export, including when embedded in another |
| Section | `## Pricing %%internal%%` | The comment is hidden in reading view; everything down to the next heading of the same level is covered |
| Block | `> [!internal] Negotiated margin` | A callout, coloured by the plugin's CSS |
| Word or phrase | `<span data-audience="internal">12 %</span>` | A dotted underline from the plugin's CSS |

Levels are declared in the settings (`internal`, `management`…). They can follow TLP too: a passage marked `%%tlp:red%%` is removed from any less restrictive export.

### Export profiles

- The settings define profiles, shared by every template, for example **Client** (removes `internal`). The full version keeps everything, with an amber label where each restricted passage starts and a dashed rule where it ends.
- A profile also sets the document's TLP, the file name suffix (`-client`, `-internal`) and what replaces a removed passage: nothing, or a "[passage removed]" note.
- A new command, *Export all versions*, writes every profile's file at once.

### Leak guarantees

1. **Filter before rendering.** The filter works on the Markdown tree, before pdfmake or Word: removed text never reaches a renderer.
2. **Cover every place text can travel:** embedded notes (recursively), footnotes, captions and alt text, Mermaid source, table cells, headings (hence the table of contents), link URLs, displayed frontmatter, file metadata (title, subject, keywords) and the file name.
3. **Fail closed.** An unclosed marker or an unknown level stops the export and points at the line.
4. **Report.** A notice such as "7 passages removed (2 sections, 3 blocks, 2 phrases)", plus an optional log note in the vault.

### Tasks

- [x] Marking syntax for the four scopes, with the offending text quoted in errors
- [x] Filter on the Markdown before rendering, including embedded notes; Obsidian comments removed from every export
- [x] Levels in the settings
- [x] TLP mapping (`%%tlp:red%%`, `data-tlp`, `tlp:` on embedded notes)
- [x] Profiles in the settings (shared by all templates): kept levels, TLP, file suffix, "[passage removed]" mark
- [x] *Export all versions* and *Export with a profile…* commands; `profile:` in the frontmatter
- [x] Full version: amber label and dashed closing rule around restricted passages, highlighted phrases
- [x] Removal notice
- [x] Optional log note in the vault
- [x] Editor CSS for `[!internal]` callouts and `data-audience` / `data-tlp` spans
- [x] Sentinel tests: a `LEAK-` string in every place text can travel; absent from the client Markdown and PDF definition, present in the full version
- [x] Documentation (EN/FR)
- [x] An example note (`example-confidential.md`), checked by a test

**Exit criterion:** the sentinel test passes in CI and blocks the release otherwise.

---

## 1.2 (beta) and 1.3 — Word export

The company's Word template carries the house style, not the plugin. The plugin fills an existing `.dotx` or `.docx` and leaves its cover page, headers and footers, theme and styles untouched. Without a Word template, it generates a clean document from the PDF template's colours and fonts.

### The Word template

1. In a plugin template, the user picks a Word file from the vault as its *Word template*.
2. They place markers in it: `{{title}}`, `{{client}}`, `{{date}}`, `{{version}}` and `{{tlp}}` on the cover, in headers and footers, and a `{{content}}` paragraph where the report goes.
3. The plugin unzips the template (`fflate`), replaces the markers and inserts the report body in place of `{{content}}`.

Word often splits a marker across several runs (`{{ti` + `tle}}` after a spell check), so a paragraph's text is joined before markers are searched.

### Style mapping

- Styles are found in `styles.xml` by their **internal name** (`heading 1`, `Caption`, `List Bullet`), which is the same in every language — the style *id* is not (`Heading1` in English Word, `Titre1` in French Word).
- The settings show a pre-filled, editable "Markdown element → Word style" table, with a dropdown of the styles found in the template.
- A style missing from the template is created from the PDF template's colours, and the user is told.

### Rendering

| Markdown | Word | Version |
|---|---|---|
| Headings 1–6 | Template heading styles; template numbering, or the plugin's numbering as text | 1.2 |
| Bold, italic, strike, inline code | Direct formatting, plus a character style for code | 1.2 |
| Links | Real hyperlinks (`w:hyperlink`) | 1.2 |
| Lists and task lists | Word numbering (`numbering.xml`); ☐ and ☑ boxes | 1.2 |
| Tables | Template table style, header row repeated on each page, widths from `tableLayout.ts` | 1.2 |
| Images | Embedded media, at the requested width | 1.2 |
| Code blocks | "Code" style, grey shading, monospace font | 1.2 |
| Page breaks | Word page breaks | 1.2 |
| TLP | `{{tlp}}` marker, coloured, in a header or footer | 1.2 |
| Table of contents | Word TOC field, updated when the document opens | 1.2 |
| Callouts | One-cell shaded table, icon as an image, bold title | 1.2 |
| Mermaid | SVG image with a PNG fallback for older Word | 1.2 |
| "Figure 1: …" captions | Caption style plus a sequence field, so Word's table of figures works | 1.3 |
| Footnotes | Real Word footnotes (`footnotes.xml`) | 1.3 |
| Columns | Borderless table | 1.3 |

The plugin writes the table of contents with its entries and links already in place, so it reads anywhere; only the page numbers wait for Word to update the fields, which the plugin asks it to do on open. Word then shows a confirmation prompt. The documentation must say so.

### Quality

- Unit tests unzip the produced `.docx` and check its XML: styles applied, markers replaced, no `{{` left.
- OOXML validation in CI with Microsoft's Open XML validator, so no file triggers "Word found unreadable content".
- Manual check of the example note in Word (Windows and Mac), LibreOffice and Google Docs at each release.
- **A public test bench of Word templates**, all freely licensed: Word's and LibreOffice's built-in templates, templates built for the project, and anonymised templates contributed by users under a licence that allows sharing. No proprietary company template is used.

### Tasks

1.2 (beta):
- [x] Word engine: package skeleton (`[Content_Types].xml`, relationships, `document.xml`)
- [x] Load a `.dotx`/`.docx`, join runs, replace markers, insert at `{{content}}`
- [x] Style mapping by internal name, settings table, missing-style fallback
- [x] 1.2 rows of the rendering table
- [x] Generated document when there is no Word template
- [x] *Export as Word* command, beta label
- [x] XML unit tests, and the sentinel leak tests on the `.docx`
- [ ] OOXML validation in CI

1.3:
- [ ] 1.3 rows of the rendering table
- [ ] Test bench of at least three public templates, rendered in Word and LibreOffice
- [ ] Documentation (EN/FR): writing a Word template, known differences in LibreOffice and Google Docs

The confidential export applies to Word from the first beta: same filter, same sentinel tests on the `.docx` XML.

---

## 2.0 — Launch as Report Exporter

- [ ] Display name "Report Exporter" (`manifest.json`, README, store listing). The plugin id `pdf-report-exporter` cannot change, so existing users keep their settings and updates.
- [ ] Documentation (EN/FR) rewritten around PDF + Word + profiles
- [ ] Contribution guide: issues, template submissions, translations
- [ ] Announcement on the Obsidian forum

---

## Feedback wanted

- **Marking syntax.** The four syntaxes above are a proposal. Which ones would you use, and which feel awkward? Tell us in the issues or the forum thread before 1.1 ships.
- **Word templates.** If you can share a template (anonymised, under a licence that allows it), it will make the Word export work for many more people.
- **Translations** beyond English and French.
