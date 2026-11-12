# Contributing to Report Exporter

Report Exporter is free, MIT-licensed and community-driven: no paid tier, no account, no telemetry. Bug reports, Word templates, translations and pull requests are all welcome. *Vous pouvez écrire en français.*

## Report a bug

Open an [issue](https://github.com/Phdhebde/Obisidian-pdf-export/issues) with:

- the plugin version (*Settings → Community plugins*) and the Obsidian version;
- **a small note that reproduces the problem** — the smallest Markdown that shows it is the most useful thing you can send;
- for a Word export, the Word template if you used one, and which application shows the problem (Word on Windows or Mac, LibreOffice, Google Docs);
- what you expected, and what you got — a screenshot of the PDF or the document helps.

Remove anything confidential first: a client's name, internal figures, a logo.

## Share a Word template

A template that renders badly is the most useful report there is: the export is only as good as the templates it has been tried on.

- **To report a problem**, attach the `.dotx` or `.docx` to an issue, with the note you exported.
- **To add it to the test bench**, open a pull request that adds it to [`templates/word`](templates/word), under a licence that allows sharing (CC0 is what the bench uses). Anonymise it: no company name, logo, people's names or real text; replace them with markers such as `{{client}}` or neutral text. Say in the pull request what it exercises — numbered headings, markers in a table, a landscape page, its own footnotes… The tests and CI then fill it with the example notes, check it with Microsoft's Open XML validator and open it in LibreOffice.

Check the author field before sharing: Word writes your name in *File → Info → Properties*.

## Translate

The interface is in English and French, in [`src/i18n.ts`](src/i18n.ts): one table per language, the same keys in each. To add a language:

1. add its code to the `Locale` type and to `setLocale`, which picks the interface language from Obsidian's;
2. copy the English table, translate the values, and register it in `MESSAGES`;
3. translate the report's fixed wording too — `LABELS` and `TLP_REMINDER` in [`src/generator.ts`](src/generator.ts).

`npm run check` refuses a table that lacks a key, so nothing is forgotten. The documentation site is in English and French, under [`website/`](website); a translation of the interface alone is already welcome.

## Code

```bash
npm install
npm run dev     # esbuild in watch mode
npm run check   # tsc --noEmit (strict)
npm run lint    # eslint with the rules of the Obsidian plugin review
npm test        # the test suite, reference outputs included
npm run reference:update   # rewrite tests/reference after an intended rendering change
npm run build   # check + production build -> main.js
```

Tests run on the TypeScript sources directly (Node ≥ 22.18, native type stripping), hence the `.ts` extensions in imports and no constructor parameter properties. To try a build in Obsidian, copy `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/pdf-report-exporter/`.

How the code is organised:

- `generator.ts` (PDF) and `docx.ts` (Word) turn Markdown into a document. They run in Node for the tests and must not import `obsidian`; anything that needs a browser — rendering a Mermaid diagram, rasterising an icon — is done by the host and handed in.
- `redact.ts` is the confidentiality filter. It runs on the Markdown **before** either engine, so removed text never reaches a renderer. Any change that touches it, or adds a place where text can travel, comes with a case in the sentinel tests (`tests/redact.test.ts`): a `LEAK-nn` string that must be absent from the client PDF and `.docx` and present in the full version.
- **Reference outputs.** `tests/reference` holds what every sample of `tests/samples.ts` renders to: the PDF document definition as JSON, each Word part as XML with one tag per line. `npm test` fails as soon as either engine renders differently, and points at the first line that changed. A refactoring leaves these files untouched. A change to the rendering updates them with `npm run reference:update`, and their diff, committed with the change, shows the reviewer exactly what it does to the PDF and the Word file. A new feature adds its case to `tests/samples.ts`.
- Word changes: run `node scripts/word-samples.ts word-samples`, then `dotnet run -c Release --project tools/ooxml-validate -- word-samples/*.docx` to check the documents against the Open XML schemas, as CI does.

Pull requests:

- One change per pull request, with a test when the behaviour changes.
- `npm run lint`, `npm test` and `npm run build` pass.
- Add a line to the next version's section of [`CHANGELOG.md`](CHANGELOG.md), written for users.
- Interface text in both languages.

## Releases

Maintainers bump the version with `npm run version-bump -- X.Y.Z`, commit, and push a tag equal to the version. The *Release* workflow tests, builds, validates the Word export and creates a draft GitHub release, published once checked.
