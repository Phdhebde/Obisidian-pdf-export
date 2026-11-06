# Security policy

Report Exporter is often used for confidential reports, and its confidential-passage filter is a security feature. Any case where a passage marked for removal ends up in an exported file — in the text, the table of contents, links, bookmarks or metadata — is treated as a vulnerability.

## Supported versions

Only the latest release receives fixes.

## Reporting a vulnerability

Please **do not open a public issue**. Report it privately through [GitHub security advisories](https://github.com/Phdhebde/Obisidian-pdf-export/security/advisories/new), with:

- the plugin and Obsidian versions,
- a minimal note (with fake data) and the profile settings that reproduce it,
- what leaked, and where in the output file.

You will get an answer within a week. Once a fix is released, the advisory is published and you are credited unless you prefer otherwise.

## Scope

The plugin makes no network request and runs entirely inside Obsidian. Out of scope: the frontmatter fields printed on the cover and references page (documented as not filtered), and issues in Obsidian itself.
