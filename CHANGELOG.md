# Changelog

## 1.1.0 (unreleased)

- **Confidential passages.** Mark a whole note (`audience: internal`), a section (`## Title %%internal%%`), a block (`> [!internal]`) or a phrase (`<span data-audience="internal">`), then export a version per audience. Marked passages a profile leaves out are removed before rendering, embedded notes included.
- Export profiles in the settings: levels kept, file name suffix, optional "[passage removed]" mark, TLP marking. A *Client* profile is created on first run; a note can pick one with `profile:`.
- New commands: *Export as PDF report with a profile…* and *Export all versions as PDF reports*.
- TLP marks: `## Title %%tlp:red%%`, `<span data-tlp="red">`, or `tlp:` on an embedded note — removed from any version marked less strictly.
- In versions that keep them, restricted passages are labelled (amber label, dashed closing rule) and marked phrases highlighted. In Obsidian, `[!internal]` callouts show in orange with a lock and marked phrases with a dotted underline.
- Optional export log note: one line per restricted export, with what was removed (counts only).
- `example-confidential.md`, a note that uses every marking.
- Unknown levels and unclosed marked phrases stop the export instead of letting text through.
- Obsidian comments (`%%…%%`) are no longer printed in exports.

## 1.0.2

- Release workflow attests build provenance for `main.js`, `manifest.json` and `styles.css`.
- Ships the Obsidian 1.13+ settings improvements that were prepared for 1.0.1 (declarative settings, `setDestructive()`, slider tooltip).

## 1.0.1

- Settings are declared to Obsidian 1.13+, so they show up in the settings search; older versions keep the same tab.
- Destructive buttons use `setDestructive()` on Obsidian 1.13+.
- The text size slider no longer calls the deprecated `setDynamicTooltip()`; before 1.13 its value is shown in the description.

## 1.0.0

First public release.

- Export a note, a selection or a whole folder as a PDF report: cover page, header and footer bands, references page (document status, contacts, recipients), clickable table of contents, body.
- In-app preview, reusing a single file and tab.
- Templates: sections and their order, per-level heading numbering, table of contents and page breaks, colors, fonts and text size, cover layout, page number format, fixed labels, built-in vector decoration or your own full-page artwork. Templates can be duplicated, and shared as self-contained JSON files.
- Markdown: Obsidian callouts with their Lucide icons, Mermaid diagrams as vectors, Obsidian Columns layouts, task lists, images (PNG/JPEG embedded, other formats converted), embedded notes, captions, manual page breaks, wide tables fitted to the page.
- Optional Traffic Light Protocol marking and reminder page.
- English and French interface; frontmatter keys accepted in both languages.
- Fonts (Liberation Sans, Liberation Mono, Archivo Black) embedded: no network access, nothing to install beside the plugin.
