# Example Word templates

Three Word templates for the plugin's Word export, written in Microsoft Word for the project. The test suite and CI fill each of them with the example notes, check the result with Microsoft's Open XML validator and open it in LibreOffice.

| Template | What it shows |
|---|---|
| `consulting-report.dotx` | Cover with every marker, `{{toc}}` on its own page, headings numbered by Word, running header from the second page, TLP and page number in the footer |
| `memo.dotx` | No cover: markers in a table at the top, a custom *Corps de rapport* body style to pick in the plugin's Word style settings |
| `landscape-brief.dotx` | A4 landscape, narrow margins, a footnote of its own |

Download one into your vault, then pick it in **Settings → Report Exporter → (template) → Word export → Word template**. How to write your own: [Word export](https://phdhebde.github.io/Obisidian-pdf-export/word-export/).

## Licence

Released into the public domain under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/): use, change and share them freely, with or without credit.

## Contributing a template

A template that renders badly is the most useful bug report there is. If you can share one — anonymised, without your company's logo or text, under a licence that allows it — open an issue or a pull request that adds it here with a note of what it exercises.
