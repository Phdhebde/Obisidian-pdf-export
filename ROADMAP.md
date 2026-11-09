# Roadmap

**Report Exporter** turns an Obsidian note into the document you actually hand over: a PDF or a Word file, a full internal version or a redacted client version, from the same templates. The goal for what comes next is simple: **make every kind of report and Word document easier to produce** — audit reports, memos, proposals, specifications, minutes, letters.

The project is and will stay **free and community-driven**: MIT licence, no paid tier, no account, no network access. Ideas, bug reports, templates and pull requests are welcome in the [issues](https://github.com/Phdhebde/Obisidian-pdf-export/issues).

| Horizon | Theme | Size | Done when |
|---|---|---|---|
| 1 | Consolidate | M | A rendering feature is written once, for both PDF and Word |
| 2 | Mobile | M | The example note exports as PDF and Word on an Android phone and an iPhone |
| 3 | Real reports | S × n | Each item ships on its own, in both formats |
| 4 | Structured blocks | L | A findings report builds its summary table by itself |
| — | Compliance | ? | Only if users ask for it |

The project is built on spare time, so there are sizes rather than dates. Horizons are taken in order; within horizon 3, items ship one by one, in the order the issues ask for them.

**Already shipped** (see the [changelog](CHANGELOG.md)): PDF reports with templates (1.0), confidential export with profiles and TLP (1.1), Word export with your own `.dotx` (1.2–1.3), the Report Exporter name (2.0).

---

## 1 — Consolidate

The PDF engine (`generator.ts`) and the Word engine (`docx.ts`) each read the Markdown on their own. Every feature and every fix is written twice — footnotes, columns, callouts, captions, the Mermaid fix of 2.0.1. Before the plugin grows, it needs one shared model of the document.

```
note ──> Markdown analysis ──> confidentiality filter ──> document model ──┬──> PDF engine  (pdfmake)      ──> report.pdf
                                                          (new, shared)    └──> Word engine (OOXML + .dotx) ──> report.docx
```

- [ ] **Document model**: numbered headings, blocks, inline runs, captions, footnotes, resolved images and diagrams — built once, read by both engines. The engines only lay it out.
- [ ] Move the PDF engine, then the Word engine, onto the model, without changing any output (the existing tests are the safety net).
- [ ] **Reference outputs**: the example notes rendered to a PDF definition and a `.docx`, compared at each build, so an unintended change in either format shows up in CI.
- [ ] **Obsidian changes**: run the tests against the next Obsidian version when it is in beta, so a change like Pele (2.0.1) is caught before users see it.
- [ ] Announcement on the Obsidian forum, to gather real-world feedback.

**Done when:** a new rendering feature is written once, in the model, and appears in both formats; the confidentiality sentinel tests still pass.

---

## 2 — Mobile

Writing a report on the go, or exporting a client version from a phone before a meeting. The code is close: files are written through the vault API, and the desktop-only calls (open the file, show it in the folder) are already optional. What remains is the runtime:

- [ ] Test the export on Android and iOS: pdfmake, image conversion through a canvas, Mermaid diagrams, Word templates.
- [ ] **Load on demand**: `main.js` weighs 5 MB, mostly fonts and pdfmake. Load them on the first export, not when Obsidian starts.
- [ ] Memory and time on a long report (50+ pages, many images): a progress notice, and a clear message rather than a crash.
- [ ] After an export, open the file in the system viewer or the share sheet instead of the file explorer.
- [ ] `isDesktopOnly: false` in `manifest.json`.

**Done when:** `example-report.md` and `example-confidential.md` export as PDF and Word on a mid-range Android phone and an iPhone, and the plugin does not slow down Obsidian's start on mobile.

---

## 3 — Real reports

What a report written in a company has, and a note does not yet. Each item is small, ships on its own, and works in the PDF and in Word.

- [ ] **Appendices**: a heading marked as an appendix starts lettered numbering (Appendix A, A.1…), listed apart in the table of contents.
- [ ] **Cross-references**: "see Figure 3", "see § 2.1", written as links to a heading or a caption, numbered at export and kept right when the document changes. In Word, real reference fields.
- [ ] **List of figures and list of tables**, as template sections (Word already has its own, thanks to the 1.3 captions).
- [ ] **Revision history**: a table built from the frontmatter (version, date, author, change), placed on the references page.
- [ ] **Approval block**: written by, reviewed by, approved by — names, roles, dates, an empty signature box.
- [ ] **Variables in the body**: `{{client}}`, `{{version}}` or any frontmatter key, written in the text, replaced at export in both formats.
- [ ] **Conditional text**: a passage kept only for some profiles or some values (`lang: fr`, `type: proposal`), using the same filter as the confidential export.
- [ ] **Glossary and acronyms**: definitions gathered from the note into a section, the first use spelled out.
- [ ] **Template gallery**: PDF templates and Word templates for common documents (report, memo, proposal, minutes, letter), shared by users and listed on the site.
- [ ] **Citations and bibliography**: Pandoc citekeys (`[@smith2020]`) resolved from a BibTeX or CSL JSON file in the vault — the largest item of this horizon.

**Done when:** each item is documented (EN/FR), tested in both formats, and checked by the Open XML validator in Word.

---

## 4 — Structured blocks

Many reports are a list of the same kind of item, with a summary table at the front: security findings, risks, action items, requirements, test results, decisions. Today the author writes the summary table by hand and keeps it in sync.

- A **block type** is declared in the settings: its fields (title, severity, owner, status, CVSS…), its allowed values and their colours.
- In the note, a block is written as a callout with fields, for example `> [!finding] SQL injection on /login` followed by `severity: high`.
- At export, each block is rendered as a card in the template's style, and **summary tables and counters are built automatically** (by severity, by status), with links to each block.
- Blocks can be sorted, numbered (F-01, F-02…) and filtered by profile, like any confidential passage.
- Shipped presets: security findings, risk register, action items. Others can be shared as JSON like templates.

**Done when:** a findings report and a risk register build their summary tables by themselves, in PDF and in Word.

---

## Compliance — on request only

- **PDF/A** (archival PDF, ISO 19005): fonts are already embedded and pdfkit, under pdfmake, supports it. To be confirmed with a spike before it is promised.
- **Accessible PDF** (PDF/UA, tagged PDF): not planned. pdfmake cannot write the structure tags it requires. The Word export already uses real heading, list and table styles, so Word can save an accessible PDF from it.

---

## Not planned

- Importing a Word document back into a note.
- Anything that needs an account, a server or network access.

---

## Feedback wanted

- **Which real-report features would you use first?** The order of horizon 3 follows the issues.
- **Mobile:** would you export from your phone or tablet, and which formats?
- **Structured blocks:** what lists do your reports repeat — findings, risks, actions, requirements?
- **Word templates.** If you can share a template (anonymised, under a licence that allows it), it will make the Word export work for many more people.
- **Translations** beyond English and French.
