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

## Verifying a release

Releases are signed with [Sigstore](https://www.sigstore.dev), bound to this repository's GitHub Actions workflows — no key to trust or rotate.

- **Releases after 2.0.1**: each one carries `provenance.sigstore.json`, the signed build provenance of `main.js`, `manifest.json` and `styles.css`. With the [GitHub CLI](https://cli.github.com):

  ```bash
  gh attestation verify main.js --repo Phdhebde/Obisidian-pdf-export
  ```

- **Earlier releases (1.2.0 to 2.0.1)** were signed afterwards: each file has a `<file>.sigstore.json` signature. With [cosign](https://docs.sigstore.dev/cosign/system_config/installation/):

  ```bash
  cosign verify-blob main.js --bundle main.js.sigstore.json \
    --certificate-identity-regexp '^https://github.com/Phdhebde/Obisidian-pdf-export/' \
    --certificate-oidc-issuer https://token.actions.githubusercontent.com
  ```

## Scope

The plugin makes no network request and runs entirely inside Obsidian. Out of scope: the frontmatter fields printed on the cover and references page (documented as not filtered), and issues in Obsidian itself.
