---
title: Frontmatter
description: The frontmatter keys PDF Report Exporter reads to fill the cover page, header, references page and PDF metadata — in English or French — including versions, contacts, recipients and the TLP marking.
---

# Frontmatter

The note's properties fill the cover, the running header, the references page and the PDF metadata. Every key is optional, and English and French keys are both understood.

```yaml
---
title: Website Migration Review     # cover + header (default: the note name)
client: ACME Corp                   # under the title in the header
subtitle: Infrastructure team       # under the cover title
acronym: INFRA                      # large, under the subtitle
author: Jane Doe                    # PDF metadata
logo: logos/acme.png                # logo on the cover (vault path or [[link]])
template: Report                    # force a template, skipping the picker
profile: Client                     # export this restricted version by default
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
audience: internal                  # keep this whole note out of restricted versions
---
```

## Keys

| Key | French equivalent | Used for |
|---|---|---|
| `title` | `titre` | Cover title, header, PDF title, `{{title}}` in file names |
| `client` | `client` | Header, `{{client}}` in file names |
| `subtitle` | `sous_titre` | Under the cover title |
| `acronym` | `acronyme` | Large text under the subtitle |
| `author` | `auteur` | PDF metadata |
| `logo` | `logo` | Cover logo, replacing the template's |
| `template` | `modele` | Template to use, by name or id |
| `profile` | `profil` | Export profile used by the normal export |
| `sections` | — | `cover`, `references`, `tlp`, `toc`, `body`, in order |
| `tlp` | `tlp` | `RED`, `AMBER+STRICT`, `AMBER`, `GREEN`, `CLEAR` (`WHITE` is read as `CLEAR`) |
| `versions` | `versions` | Document status table: `version`, `date`, `status` (`etat`) |
| `contacts` | `contacts` | Contacts table: `name` (`nom`), `role` (`poste`), `email` (`courriel`) |
| `recipients` | `destinataires` | Recipients table: `name`, `company` (`societe`) or `role`, `email` |
| `audience` | `audience` | Restricts the whole note — see [Confidential export](confidential-export.md) |

## Behaviours worth knowing

- **Recipients** appear only when the note names at least one, or when the template turns the table on. An entry with every field empty is ignored, so the block inserted by *Insert report frontmatter* has no effect until you fill it in.
- **TLP:** without a `tlp` key nothing is printed — unless the template includes the *TLP reminder* page, in which case the report is marked `TLP:CLEAR`. An unrecognised value (`tlp: rouge`) raises a warning instead of being applied silently.
- **Logo:** a `logo:` that cannot be found raises a warning rather than silently falling back to the template's logo.
- Frontmatter fields printed on the cover and the references page are **not** filtered by export profiles: keep confidential details out of them.
